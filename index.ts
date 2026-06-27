// Minimal echo CLI: read a line, print it back uppercased, repeat.
while (true) {
	// Exit on EOF.
	const untrimmedLine = prompt(">");
	if (untrimmedLine === null) break;

	// Exit by typing "/exit".
	const line = untrimmedLine.trim();
	if (line === "/exit") break;

	console.log(line.toUpperCase());
}
