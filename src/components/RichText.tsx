import { Fragment, type ReactNode } from 'react';

/**
 * Безопасное отображение простой разметки из ответов ИИ: **жирный**, списки, заголовки.
 * Строится из React-элементов, без dangerouslySetInnerHTML, поэтому HTML из ответа не выполняется.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith('**') && part.endsWith('**') ? (
      <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>
    ),
  );
}

export default function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  let ordered = false;

  const flush = () => {
    if (items.length === 0) return;
    const key = `l${blocks.length}`;
    const lis = items.map((it, i) => <li key={i}>{inline(it, `${key}-${i}`)}</li>);
    blocks.push(
      ordered ? (
        <ol key={key} className="my-1 ml-5 list-decimal">
          {lis}
        </ol>
      ) : (
        <ul key={key} className="my-1 ml-5 list-disc">
          {lis}
        </ul>
      ),
    );
    items = [];
  };

  text.split('\n').forEach((raw, idx) => {
    const line = raw.trimEnd();
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);

    if (ol) {
      if (items.length && !ordered) flush();
      ordered = true;
      items.push(ol[1]);
      return;
    }
    if (ul) {
      if (items.length && ordered) flush();
      ordered = false;
      items.push(ul[1]);
      return;
    }

    flush();
    if (!line.trim()) return;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    blocks.push(
      <p key={`p${idx}`} className={heading ? 'font-medium' : undefined}>
        {inline(heading ? heading[1] : line, `p${idx}`)}
      </p>,
    );
  });
  flush();

  return <div className="space-y-1">{blocks}</div>;
}
