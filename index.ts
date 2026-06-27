// Minimal echo CLI: read a line, print it back uppercased, repeat.
// `prompt` is a Bun built-in (no import needed). It returns null on EOF (Ctrl+D).
while (true) {
	const line = prompt(">");
	if (line === null) break;

	console.log(line.toUpperCase());
}
