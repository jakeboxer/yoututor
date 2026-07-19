/**
 * A buffer that converts streaming textDelta events into complete blocks.
 *
 * A "block" is a chunk of text. Blocks are delimited by non-code-fenced blank lines.
 */
export default class BlockBuffer {
	private lines: string[] = [];
	private inCodeFence = false;
	private partial = "";

	/**
	 * Push a piece of text onto the buffer.
	 * @param delta The new piece of text to push.
	 * @returns Any blocks that were completed as a result of this push.
	 */
	push(delta: string): string[] {
		// Prepend the existing partial string to the new delta, because the start of the new delta may
		// be the rest of a partial line that started in the previous delta
		const text = this.partial + delta;

		// Split the new partial string up by newline. The last element is either an incomplete line
		// ("a\nb" => "b") or an empty string ("a\n" => ""), which becomes the new partial.
		const completeLines = text.split("\n");
		this.partial = completeLines.pop() ?? "";

		const resultBlocks: string[] = [];

		for (const line of completeLines) {
			// Keep track of whether or not we're in a code fence.
			if (/^\s*(```|~~~)/.test(line)) {
				this.inCodeFence = !this.inCodeFence;
			}

			if (!this.inCodeFence && line.trim() === "") {
				// If we hit an empty line (and we're not in a code fence), we're on a block boundary.
				if (this.lines.length) {
					// If the block we've been building up has any content, join it up into a single string.
					resultBlocks.push(this.lines.join("\n"));
				}

				// Reset the buffer's set of lines in preparation for the next line.
				this.lines = [];
			} else {
				// We're in the middle of a block's content, keep building it up.
				this.lines.push(line);
			}
		}

		return resultBlocks;
	}

	/**
	 * Clear the buffer and get whatever content was left in it.
	 * @returns A block with all the content that was left in the buffer (or null if it was
	 * empty/whitespace).
	 */
	flush(): string | null {
		if (this.partial.trim() !== "") {
			this.lines.push(this.partial);
		}

		const result = this.lines.join("\n");

		this.reset();

		if (result === "") {
			return null;
		} else {
			return result;
		}
	}

	private reset() {
		this.lines = [];
		this.partial = "";
		this.inCodeFence = false;
	}
}
