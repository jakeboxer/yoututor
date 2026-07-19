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

function tick() {
	return new Promise((resolve) => setTimeout(resolve, 0));
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

test("reply markdown renders without raw markers", () => {
	const { app, instance } = mountForTest();
	app.handle({ type: "textDelta", text: "**bold** item" });
	app.handle({ type: "modelResponded" });

	const lastFrame = instance.lastFrame();
	expect(lastFrame).toContain("bold");
	expect(lastFrame).not.toContain("**");
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

test("prompt appears, input request promise is pending", async () => {
	const { app, instance } = mountForTest();
	let resolved = false;

	app.requestInput().then(() => {
		resolved = true;
	});

	// Let TextInput mount.
	await tick();

	expect(resolved).toBeFalse();
	expect(instance.lastFrame()).toContain(">");
});

test("submit input", async () => {
	const { app, instance } = mountForTest();
	const input = app.requestInput();

	// Let TextInput mount.
	await tick();

	instance.stdin.write("hi");
	await tick();

	// Enter should fire TextInput's onSubmit.
	instance.stdin.write("\r");
	const result = await input;
	const lastFrame = instance.lastFrame();

	expect(result).toBe("hi");
	expect(lastFrame).toContain("> hi");
	expect(lastFrame).toContain("Thinking...");
});

test("empty submit does not resolve", async () => {
	const { app, instance } = mountForTest();
	let resolved = false;

	app.requestInput().then(() => {
		resolved = true;
	});

	// Let TextInput mount.
	await tick();

	// Enter should fire TextInput's onSubmit.
	instance.stdin.write("\r");
	await tick();

	expect(resolved).toBeFalse();

	// We can't use a normal toContain(">") here, because both the live prompt and an echoed prompt
	// start with this string. However, if there's an echoed prompt, there's always also a live
	// prompt, which means there would be at least 2 instances of ">". Because of this, we can just
	// check the count of lines with ">".
	expect(
		instance
			.lastFrame()
			?.split("\n")
			.filter((l) => l.includes(">")).length,
	).toBe(1);
});

test("Ctrl+D while awaiting input resolves null", async () => {
	const { app, instance } = mountForTest();
	const input = app.requestInput();

	// Let TextInput mount.
	await tick();

	// EOT byte. Ink parses this as Ctrl+D.
	instance.stdin.write("\x04");

	expect(await input).toBeNull();
});

test("Ctrl+D while busy is a no-op", async () => {
	const { instance } = mountForTest();
	const before = instance.lastFrame();

	// Let TextInput mount.
	await tick();

	// EOT byte. Ink parses this as Ctrl+D.
	instance.stdin.write("\x04");

	expect(instance.lastFrame()).toBe(before);
});
