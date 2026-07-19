import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "ink-testing-library";
import { InkApp } from "./ink-app.tsx";

afterEach(cleanup);

function mountForTest() {
	let instance!: ReturnType<typeof render>;
	const app = InkApp.mount((tree) => {
		instance = render(tree);
		return { rerender: instance.rerender, unmount: instance.unmount, clear: () => {} };
	});

	return { app, instance };
}

test("mount shows the activity indicator", () => {
	const { instance } = mountForTest();
	expect(instance.lastFrame()).toContain("Thinking...");
});

test("textDelta event accumulates", () => {
	const { app, instance } = mountForTest();
	app.handle({ type: "textDelta", text: "text1" });
	app.handle({ type: "textDelta", text: "text2" });

	expect(instance.lastFrame()).toContain("text1text2");
});

test("modelResponded event moves the reply into the log", () => {
	const { app, instance } = mountForTest();
	app.handle({ type: "textDelta", text: "  answer  " });
	app.handle({ type: "modelResponded" });

	const lastFrame = instance.lastFrame();
	expect(lastFrame?.split("\n")).toContain("answer"); // Split to make sure whitespace trim works.
	expect(lastFrame).toContain("Thinking...");
});

test("whitespace-only reply appends nothing", () => {
	const { app, instance } = mountForTest();
	const before = instance.lastFrame();

	app.handle({ type: "textDelta", text: "   " });
	app.handle({ type: "modelResponded" });

	expect(instance.lastFrame()).toBe(before);
});

test("toolRunStarted displays properly", () => {
	const { app, instance } = mountForTest();
	app.handle({ type: "toolRunStarted", name: "get_frames", input: { timestamps: ["0:45"] } });

	const lastFrame = instance.lastFrame();
	expect(lastFrame).toContain('⚙ get_frames {"timestamps":["0:45"]}');
	expect(lastFrame).toContain("Running get_frames");
});

test("toolRunFinished displays properly", () => {
	const { app, instance } = mountForTest();
	app.handle({ type: "toolRunStarted", name: "get_frames", input: { timestamps: ["0:45"] } });
	app.handle({ type: "toolRunFinished", name: "get_frames", result: "" });

	const lastFrame = instance.lastFrame();
	expect(lastFrame).toContain("✓ get_frames");
	expect(lastFrame).toContain("Thinking...");
	expect(lastFrame).not.toContain("Running get_frames");
});
