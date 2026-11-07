import { Dialog, Plugin, Setting, showMessage } from "siyuan";
import { Entry, NoticeLog, when } from "./log";

interface Settings { persist: boolean; max: number; statusBar: boolean }
const DEFAULTS: Settings = { persist: true, max: 200, statusBar: true };
interface Data { settings?: Partial<Settings>; entries?: (Entry & { error?: boolean })[] }
const STORE = "history.json";

// English fallbacks, so a missing language file never shows an empty label.
const EN: Record<string, string> = {
	title: "Notification history", open: "Show notification history", clear: "Clear notification history",
	filter: "Filter", copyAll: "Copy all", clearBtn: "Clear", copy: "Copy", copied: "Copied", copyFailed: "Could not copy to the clipboard",
	empty: "No notifications yet. They will appear here as SiYuan and your plugins show them.", noMatch: "No notification matches.",
	errorsOnly: "Errors only", yesterday: "Yesterday",
	persist: "Keep history after restart", persistDesc: "Off: the list starts empty each time SiYuan opens.",
	max: "Notifications to keep", maxDesc: "Older ones are dropped.",
	statusBar: "Bell in the status bar", statusBarDesc: "Shows how many notifications came since you last looked.",
};

const BELL = `<symbol id="iconNhBell" viewBox="0 0 32 32"><path d="M16 3a9 9 0 0 0-9 9v6.6l-2.6 4.3A1.4 1.4 0 0 0 5.6 25h20.8a1.4 1.4 0 0 0 1.2-2.1L25 18.6V12a9 9 0 0 0-9-9zm0 2.6a6.4 6.4 0 0 1 6.4 6.4v7.3l1.7 3.1H7.9l1.7-3.1V12A6.4 6.4 0 0 1 16 5.6zM12.4 26.6a3.7 3.7 0 0 0 7.2 0z"/></symbol>`;

export default class NotificationHistory extends Plugin {
	settings: Settings = { ...DEFAULTS };
	log = new NoticeLog();
	errors = new Set<number>(); // entry ids that came from an error notification
	private ids = new WeakMap<HTMLElement, number>();
	private observer?: MutationObserver;
	private bodyObserver?: MutationObserver;
	private unseen = 0;
	private statusEl?: HTMLElement;
	private saveTimer = 0;
	private quiet = 0; // our own "Copied" messages are not logged
	private view?: HistoryView;

	t(key: string): string {
		const v = this.i18n?.[key];
		return typeof v === "string" && v ? v : EN[key];
	}

	async onload() {
		const data = ((await this.loadData(STORE).catch(() => null)) as Data | null) || {};
		this.settings = { ...DEFAULTS, ...(data.settings || {}) };
		this.log.load(this.settings.persist ? data.entries : [], this.settings.max);
		for (const e of (this.settings.persist ? data.entries : []) || []) if (e?.error) this.errors.add(e.id);

		this.addIcons(BELL);
		this.addCommand({ langKey: "open", langText: this.t("open"), hotkey: "", callback: () => this.open() });
		this.addCommand({ langKey: "clear", langText: this.t("clear"), hotkey: "", callback: () => this.clear() });
		this.initSetting();
		this.watch();
	}

	onLayoutReady() {
		this.addTopBar({ icon: "iconNhBell", title: this.t("title"), position: "right", callback: () => this.open() });
		this.drawStatus();
	}

	onunload() {
		this.observer?.disconnect();
		this.bodyObserver?.disconnect();
		window.clearTimeout(this.saveTimer);
		this.view?.dialog.destroy();
		void this.persist();
	}

	async uninstall() {
		await this.removeData(STORE).catch(() => undefined);
	}

	// SiYuan draws each message as .b3-snackbar[data-id] inside #message. A message shown again with the same id
	// (progress, sync status) gets new inner HTML in the same element, so that is an edit, not a new entry.
	private watch() {
		const attach = () => {
			const box = document.getElementById("message");
			if (!box || this.observer) return !!box;
			box.querySelectorAll<HTMLElement>(".b3-snackbar").forEach((el) => this.seen(el));
			this.observer = new MutationObserver((muts) => {
				for (const m of muts) {
					m.addedNodes.forEach((n) => {
						if (!(n instanceof HTMLElement)) return;
						if (n.classList.contains("b3-snackbar")) this.seen(n);
						else this.edited(n);
					});
					if (m.type === "characterData") this.edited(m.target);
				}
			});
			this.observer.observe(box, { childList: true, subtree: true, characterData: true });
			return true;
		};
		if (attach()) return;
		this.bodyObserver = new MutationObserver(() => { if (attach()) this.bodyObserver?.disconnect(); });
		this.bodyObserver.observe(document.body, { childList: true, subtree: true });
	}

	private text(el: HTMLElement): string {
		const c = el.querySelector<HTMLElement>(".b3-snackbar__content") || el;
		return (c.innerText || c.textContent || "").trim();
	}

	private seen(el: HTMLElement): void {
		if (this.ids.has(el)) return this.edited(el);
		if (this.quiet > 0) { this.quiet--; this.ids.set(el, 0); return; }
		const e = this.log.add(this.text(el), Date.now());
		if (!e) return; // text may arrive later; edited() picks it up
		this.ids.set(el, e.id);
		if (el.classList.contains("b3-snackbar--error")) this.errors.add(e.id);
		this.unseen++;
		this.changed();
	}

	private edited(node: Node): void {
		const el = (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>(".b3-snackbar");
		if (!el) return;
		const id = this.ids.get(el);
		if (id === undefined) return this.seen(el);
		if (!id) return;
		const before = this.log.entries.find((x) => x.id === id)?.text;
		this.log.update(id, this.text(el));
		if (el.classList.contains("b3-snackbar--error")) this.errors.add(id);
		if (this.log.entries.find((x) => x.id === id)?.text !== before) this.changed();
	}

	changed() {
		this.drawStatus();
		this.view?.draw();
		window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => void this.persist(), 2000);
	}

	clear() {
		this.log.clear();
		this.errors.clear();
		this.unseen = 0;
		this.changed();
	}

	async persist() {
		const entries = this.settings.persist ? this.log.entries.map((e) => ({ ...e, error: this.errors.has(e.id) || undefined })) : [];
		await this.saveData(STORE, { settings: this.settings, entries });
	}

	drawStatus() {
		if (!this.settings.statusBar) { this.statusEl?.remove(); this.statusEl = undefined; return; }
		if (!this.statusEl) {
			const el = document.createElement("div");
			el.className = "toolbar__item ariaLabel nh-status";
			el.setAttribute("aria-label", this.t("title"));
			el.addEventListener("click", () => this.open());
			this.statusEl = this.addStatusBar({ element: el, position: "right" });
		}
		this.statusEl.innerHTML = `<svg><use xlink:href="#iconNhBell"></use></svg>${this.unseen ? `<span class="nh-badge">${this.unseen}</span>` : ""}`;
	}

	open() {
		this.unseen = 0;
		this.drawStatus();
		if (this.view) return;
		this.view = new HistoryView(this, () => (this.view = undefined));
	}

	copy(text: string) {
		const done = () => { this.quiet++; showMessage(this.t("copied"), 1500); };
		// The async clipboard can be refused (browser tab without focus or permission): fall back to execCommand.
		navigator.clipboard.writeText(text).then(done, () => {
			const ta = document.createElement("textarea");
			ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
			document.body.append(ta); ta.select();
			const ok = document.execCommand("copy");
			ta.remove();
			if (ok) done(); else showMessage(this.t("copyFailed"), 3000, "error");
		});
	}

	private initSetting() {
		const toggle = (key: "persist" | "statusBar") => {
			const input = document.createElement("input");
			input.type = "checkbox";
			input.className = "b3-switch fn__flex-center";
			input.checked = this.settings[key];
			input.addEventListener("change", () => {
				this.settings[key] = input.checked;
				if (key === "statusBar") this.drawStatus();
				void this.persist();
			});
			return input;
		};
		const select = document.createElement("select");
		select.className = "b3-select fn__flex-center fn__size200";
		for (const n of [50, 100, 200, 500, 1000]) select.add(new Option(String(n), String(n), false, n === this.settings.max));
		select.addEventListener("change", () => {
			this.settings.max = Number(select.value);
			this.log.load(this.log.entries, this.settings.max);
			this.changed();
		});
		this.setting = new Setting({});
		this.setting.addItem({ title: this.t("persist"), description: this.t("persistDesc"), actionElement: toggle("persist") });
		this.setting.addItem({ title: this.t("max"), description: this.t("maxDesc"), actionElement: select });
		this.setting.addItem({ title: this.t("statusBar"), description: this.t("statusBarDesc"), actionElement: toggle("statusBar") });
	}
}

class HistoryView {
	dialog: Dialog;
	private filter = "";
	private errorsOnly = false;
	private listEl: HTMLElement;

	constructor(private p: NotificationHistory, onGone: () => void) {
		this.dialog = new Dialog({
			title: p.t("title"),
			width: "min(720px, 92vw)",
			height: "min(640px, 80vh)",
			content: `<div class="b3-dialog__content nh-dialog">
	<div class="nh-bar">
		<input class="b3-text-field nh-search" type="search" placeholder="${p.t("filter")}">
		<label class="nh-errors"><input type="checkbox" class="b3-switch"> ${p.t("errorsOnly")}</label>
		<button class="b3-button b3-button--outline" data-action="copy">${p.t("copyAll")}</button>
		<button class="b3-button b3-button--remove" data-action="clear">${p.t("clearBtn")}</button>
	</div>
	<div class="nh-list"></div>
</div>`,
			destroyCallback: onGone,
		});
		const root = this.dialog.element;
		this.listEl = root.querySelector(".nh-list") as HTMLElement;
		const search = root.querySelector(".nh-search") as HTMLInputElement;
		search.addEventListener("input", () => { this.filter = search.value.toLowerCase(); this.draw(); });
		const errs = root.querySelector(".nh-errors input") as HTMLInputElement;
		errs.addEventListener("change", () => { this.errorsOnly = errs.checked; this.draw(); });
		root.querySelector('[data-action="copy"]')?.addEventListener("click", () =>
			p.copy(this.shown().map((e) => `${when(e.time, Date.now(), p.t("yesterday"))}  ${e.text}`).join("\n\n")));
		root.querySelector('[data-action="clear"]')?.addEventListener("click", () => p.clear());
		this.listEl.addEventListener("click", (ev) => {
			const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-copy]");
			const e = btn && p.log.entries.find((x) => x.id === Number(btn.dataset.copy));
			if (e) p.copy(e.text);
		});
		this.draw();
		search.focus();
	}

	private shown() {
		const f = this.filter;
		return this.p.log.entries.filter((e) => (!f || e.text.toLowerCase().includes(f)) && (!this.errorsOnly || this.p.errors.has(e.id)));
	}

	draw() {
		const list = this.shown();
		this.listEl.innerHTML = "";
		if (!list.length) {
			const d = document.createElement("div");
			d.className = "nh-empty";
			d.textContent = this.filter || this.errorsOnly ? this.p.t("noMatch") : this.p.t("empty");
			this.listEl.append(d);
			return;
		}
		const now = Date.now();
		for (const e of list) {
			const row = document.createElement("div");
			row.className = "nh-row" + (this.p.errors.has(e.id) ? " nh-row--error" : "");
			const meta = document.createElement("div");
			meta.className = "nh-meta";
			const time = document.createElement("span");
			time.textContent = when(e.time, now, this.p.t("yesterday"));
			meta.append(time);
			if (e.count > 1) {
				const c = document.createElement("span");
				c.className = "nh-count";
				c.textContent = `×${e.count}`;
				meta.append(c);
			}
			const copy = document.createElement("span");
			copy.className = "block__icon block__icon--show nh-copy ariaLabel";
			copy.dataset.copy = String(e.id);
			copy.setAttribute("aria-label", this.p.t("copy"));
			copy.innerHTML = `<svg><use xlink:href="#iconCopy"></use></svg>`;
			meta.append(copy);
			const text = document.createElement("div");
			text.className = "nh-text";
			text.textContent = e.text;
			row.append(meta, text);
			this.listEl.append(row);
		}
	}
}
