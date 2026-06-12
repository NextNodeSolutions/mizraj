import { useAtomValue } from 'jotai'

import { toastsAtom } from '@/shared/toasts'

export const Toasts = (): React.JSX.Element => {
	const toasts = useAtomValue(toastsAtom)

	return (
		<div className="toast-viewport">
			{toasts.map(toast => (
				<div
					key={toast.id}
					className="toast"
					data-show="true"
					role="status"
				>
					<span className="tk">✓</span>
					<span>{toast.message}</span>
				</div>
			))}
		</div>
	)
}
