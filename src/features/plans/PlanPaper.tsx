import type { PlanDoc } from './planDoc'
import { PlanPanel } from './PlanPanel'
import type { PlanKind } from './plans'

const KIND_TAG_CLASS: Readonly<Record<PlanKind, string>> = {
	plan: 'tag tag-rev',
	interview: 'tag tag-acc',
}

type Props = {
	doc: PlanDoc
}

/**
 * The document paper: head (title + kind tag), mono meta line and the
 * framed plan:// viewer. Mounted keyed by kind/slug so switching docs
 * replays the stagger entrance.
 */
// TODO: native intro/Q&A rendering needs structured plan/interview data; today the doc body is the plan:// iframe
export const PlanPaper = ({ doc }: Props): React.JSX.Element => (
	<div className="pl-doc">
		<div className="pl-paper stagger">
			<div className="pl-doc-head">
				<h1>{doc.title}</h1>
				<span className={KIND_TAG_CLASS[doc.kind]}>{doc.kind}</span>
			</div>
			<p className="pl-doc-meta">{doc.meta}</p>
			<PlanPanel src={doc.url} title={`${doc.kind}/${doc.slug}`} />
		</div>
	</div>
)
