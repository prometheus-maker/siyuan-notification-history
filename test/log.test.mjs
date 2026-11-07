import { test } from "node:test";
import assert from "node:assert/strict";
import { NoticeLog, when } from "../build/log.mjs";

test("newest first, duplicates within 10 s are counted", () => {
	const l = new NoticeLog(3);
	l.add("a", 0); l.add("b", 1000); l.add("b", 5000); l.add("b", 20_000);
	assert.deepEqual(l.entries.map((e) => [e.text, e.count]), [["b", 1], ["b", 2], ["a", 1]]);
});

test("max entries and blank text", () => {
	const l = new NoticeLog(2);
	assert.equal(l.add("   ", 0), null);
	l.add("1", 0); l.add("2", 20_000); l.add("3", 40_000);
	assert.deepEqual(l.entries.map((e) => e.text), ["3", "2"]);
});

test("update keeps latest text; load restores ids", () => {
	const l = new NoticeLog();
	const e = l.add("Indexing 1/10", 0);
	l.update(e.id, "Indexing 10/10");
	assert.equal(l.entries[0].text, "Indexing 10/10");
	const m = new NoticeLog();
	m.load(l.entries, 50);
	assert.equal(m.add("new", 99_999).id, e.id + 1);
});

test("when", () => {
	const now = new Date(2026, 10, 7, 15, 0, 0).getTime();
	assert.equal(when(new Date(2026, 10, 7, 14, 5, 9).getTime(), now), "14:05:09");
	assert.equal(when(new Date(2026, 10, 6, 9, 1).getTime(), now), "Yesterday 09:01");
	assert.equal(when(new Date(2026, 2, 9, 14, 5).getTime(), now), "9 Mar 14:05");
	assert.equal(when(new Date(2025, 2, 9, 14, 5).getTime(), now), "9 Mar 2025 14:05");
});
