import { useEffect, useState } from 'react'

// TODO(route-restore): the app always boots at '/'; persist the last
// pathname+search via the settings store and restore it after settings.ready.
export const navigate = (href: string): void => {
	// Compare the full location (path + query) so '/?filter=running' is a
	// real navigation from '/', and re-navigating it is still a no-op.
	if (window.location.pathname + window.location.search === href) return
	window.history.pushState({}, '', href)
	window.dispatchEvent(new PopStateEvent('popstate'))
}

const readPathname = (): string => window.location.pathname

const readSearch = (): string => window.location.search

// Both location hooks ride the same popstate subscription; navigate() above
// dispatches a synthetic popstate so pushes re-render subscribers too.
const useLocationValue = (read: () => string): string => {
	const [value, setValue] = useState<string>(read)
	useEffect(() => {
		const handler = (): void => setValue(read())
		window.addEventListener('popstate', handler)
		// Resync once after attaching: a popstate fired between this hook's
		// initial render and the effect mounting would otherwise be missed,
		// leaving `value` stale against the live location.
		setValue(read())
		return () => window.removeEventListener('popstate', handler)
	}, [read])
	return value
}

export const usePathname = (): string => useLocationValue(readPathname)

export const useLocationSearch = (): string => useLocationValue(readSearch)
