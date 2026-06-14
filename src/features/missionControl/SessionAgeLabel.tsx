import { useNow } from '@/shared/useNow'

import { formatSessionAge } from './sessionAge'

const AGE_REFRESH_MS = 30_000

type Props = {
	startedAt: number
}

/**
 * The card's relative-time label as its own leaf: it owns the 30s clock so a
 * tick re-renders only the time text, never the whole agent wall.
 */
export const SessionAgeLabel = ({ startedAt }: Props): React.JSX.Element => {
	const now = useNow(AGE_REFRESH_MS)
	return <span className="time">{formatSessionAge(now, startedAt)}</span>
}
