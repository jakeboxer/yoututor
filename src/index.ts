import Agent from "./agent/agent";

for await (const event of new Agent().run()) {
	if (event.type === "text") {
		console.log(event.text);
	}
}
