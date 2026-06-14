type Props = {
	tail: ReadonlyArray<string>
}

// A running session card's last-output window: at most a couple of lines,
// rendered without a list so no synthetic keys are needed; the blinking caret
// rides the most recent line.
export const TerminalPreview = ({ tail }: Props): React.JSX.Element => (
	<div className="term mini-term pipeline__term">
		{tail.length > 1 && <div className="term-line">{tail[0]}</div>}
		<div className="term-line">
			{tail.length === 0 ? '…' : tail[tail.length - 1]}
			<span className="caret" />
		</div>
	</div>
)
