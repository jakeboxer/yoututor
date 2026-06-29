// The Input port. When the loop needs the user's next turn it `await`s this, so it never knows
// whether input comes from a terminal prompt or an Ink text field.Returns null on EOF, which
// ends the session. It's async so a UI host (which resolves only when the user submits) and a
// console host (which is blocking) fit the same shape.

export default type Host = {
	requestInput(): Promise<string | null>;
};
