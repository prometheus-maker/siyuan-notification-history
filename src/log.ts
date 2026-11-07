// Pure notification log, no SiYuan imports, so it can be unit-tested.
export interface Entry { id: number; time: number; text: string; count: number }

export class NoticeLog {
	entries: Entry[] = [];
	private nextId = 1;
	constructor(public max = 200) {}

	/** Record a new notice. The same text again within 10 s bumps the count instead of adding a row. */
	add(text: string, time: number): Entry | null {
		text = text.trim();
		if (!text) return null;
		const last = this.entries[0];
		if (last && last.text === text && time - last.time < 10_000) {
			last.count++;
			last.time = time;
			return last;
		}
		const e: Entry = { id: this.nextId++, time, text, count: 1 };
		this.entries.unshift(e);
		if (this.entries.length > this.max) this.entries.length = this.max;
		return e;
	}

	/** A notice changed its text while on screen (progress notices do this): keep the latest text. */
	update(id: number, text: string): void {
		const e = this.entries.find((x) => x.id === id);
		if (e && text.trim()) e.text = text.trim();
	}

	clear(): void { this.entries = []; }

	load(saved: Entry[] | undefined, max: number): void {
		this.max = max;
		this.entries = (saved ?? []).filter((e) => e && typeof e.text === "string").slice(0, max);
		this.nextId = this.entries.reduce((m, e) => Math.max(m, e.id), 0) + 1;
	}
}

/** "14:05:09" today, "Yesterday 14:05", otherwise "9 Mar 14:05". */
export function when(time: number, now: number, yesterday = "Yesterday"): string {
	const d = new Date(time), n = new Date(now);
	const hm = (x: Date, s = false) => [x.getHours(), x.getMinutes(), ...(s ? [x.getSeconds()] : [])].map((v) => String(v).padStart(2, "0")).join(":");
	const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const diff = Math.round((day(n) - day(d)) / 86_400_000);
	if (diff === 0) return hm(d, true);
	if (diff === 1) return `${yesterday} ${hm(d)}`;
	const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
	return `${d.getDate()} ${mon}${d.getFullYear() !== n.getFullYear() ? " " + d.getFullYear() : ""} ${hm(d)}`;
}
