import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve as resolvePath } from 'node:path'

type Kind = 'interview' | 'plan'

const KIND_TO_DIR: Record<Kind, string> = {
	interview: 'docs/interviews',
	plan: 'docs/plans',
}

const PATH_SEGMENT_COUNT = 3
const JSON_INDENT = 2

const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_NOT_FOUND = 404
const HTTP_SERVER_ERROR = 500

const isKind = (value: string): value is Kind =>
	value === 'interview' || value === 'plan'

const SLUG_MAX_LEN = 128
const SLUG_REGEX = /^[A-Za-z0-9_-]+$/

const isSafeSlug = (value: string): boolean =>
	value.length >= 1 && value.length <= SLUG_MAX_LEN && SLUG_REGEX.test(value)

type Routed = {
	kind: Kind
	slug: string
	action: 'plan.html' | 'submit'
}

const route = (path: string): Routed | null => {
	const segments = path.replace(/^\/+/, '').split('/').filter(Boolean)
	if (segments.length !== PATH_SEGMENT_COUNT) return null
	const [kindSegment, slug, action] = segments
	if (!isKind(kindSegment)) return null
	if (!isSafeSlug(slug)) return null
	if (action !== 'plan.html' && action !== 'submit') return null
	return { kind: kindSegment, slug, action }
}

const readBody = (req: IncomingMessage): Promise<string> =>
	new Promise((res, rej) => {
		const chunks: Buffer[] = []
		req.on('data', (chunk: Buffer) => chunks.push(chunk))
		req.on('end', () => res(Buffer.concat(chunks).toString('utf8')))
		req.on('error', rej)
	})

const sendText = (res: ServerResponse, status: number, body: string): void => {
	res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
	res.end(body)
}

const sendJson = (
	res: ServerResponse,
	status: number,
	payload: unknown,
): void => {
	res.writeHead(status, { 'content-type': 'application/json' })
	res.end(JSON.stringify(payload))
}

const isAddressInfo = (value: unknown): value is AddressInfo => {
	if (typeof value !== 'object' || value === null) return false
	if (!('port' in value)) return false
	const port: unknown = Reflect.get(value, 'port')
	return typeof port === 'number'
}

type CreateServerOptions = {
	projectRoot: string
	fixtureHtmlPath: string
}

export type TestServer = {
	port: number
	close: () => Promise<void>
}

export const startTestServer = async ({
	projectRoot,
	fixtureHtmlPath,
}: CreateServerOptions): Promise<TestServer> => {
	const handler = async (
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> => {
		const path = req.url ?? ''
		const routed = route(path)
		if (!routed) return sendText(res, HTTP_NOT_FOUND, 'unrecognized path')

		const targetDir = resolvePath(
			projectRoot,
			KIND_TO_DIR[routed.kind],
			routed.slug,
		)

		if (req.method === 'GET' && routed.action === 'plan.html') {
			const html = await readFile(fixtureHtmlPath, 'utf8')
			res.writeHead(HTTP_OK, {
				'content-type': 'text/html; charset=utf-8',
			})
			res.end(html)
			return
		}

		if (req.method === 'POST' && routed.action === 'submit') {
			const raw = await readBody(req)
			let parsed: unknown
			try {
				parsed = JSON.parse(raw)
			} catch {
				return sendText(res, HTTP_BAD_REQUEST, 'invalid JSON body')
			}
			const pretty = JSON.stringify(parsed, null, JSON_INDENT)
			await mkdir(targetDir, { recursive: true })
			const target = join(targetDir, 'submission.json')
			await writeFile(target, pretty, 'utf8')
			return sendJson(res, HTTP_OK, { ok: true, path: target })
		}

		return sendText(res, HTTP_NOT_FOUND, 'method or action not handled')
	}

	const server: Server = createServer((req, res) => {
		handler(req, res).catch((err: unknown) => {
			const message = err instanceof Error ? err.message : 'unknown error'
			if (!res.headersSent) sendText(res, HTTP_SERVER_ERROR, message)
			else res.end()
		})
	})

	await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
	const address = server.address()
	if (!isAddressInfo(address)) {
		throw new Error('test server failed to bind to a TCP port')
	}

	return {
		port: address.port,
		close: () =>
			new Promise<void>((done, fail) =>
				server.close(err => (err ? fail(err) : done())),
			),
	}
}
