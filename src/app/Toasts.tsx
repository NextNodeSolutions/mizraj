import { useAtomValue } from 'jotai'

import { toastsAtom } from '@/shared/toasts'

export const Toasts = (): React.JSX.Element => {
	const toasts = useAtomValue(toastsAtom)

	return (
		<div className="toast-viewport" role="status" aria-live="polite">
			{toasts.map(toast => (
				<div key={toast.id} className="toast">
					{toast.message}
				</div>
			))}
		</div>
	)
}
