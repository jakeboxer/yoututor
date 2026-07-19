import { Text } from "ink";
import { useEffect, useState } from "react";

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export default function Spinner() {
	const [frameIndex, setFrameIndex] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setFrameIndex((prev) => (prev + 1) % FRAMES.length);
		}, 80);

		return () => {
			clearInterval(interval);
		};
	}, []);

	return <Text>{FRAMES[frameIndex]}</Text>;
}
