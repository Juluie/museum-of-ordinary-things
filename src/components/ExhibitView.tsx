import type { ReactNode } from 'react'
import { formatNumber } from '../lib/format.ts'
import { ExhibitImage } from './ExhibitImage.tsx'

export type ExhibitViewData = {
  number: number | null
  title: string
  story: string
  authorName: string | null
  keptSince: string | null
  imageAlt: string
  imageUrl: string
  imageWidth: number | null
  imageHeight: number | null
}

type Props = {
  exhibit: ExhibitViewData
  onImageExpired?: () => Promise<string | null>
  /** Уровень заголовка: на странице экспоната — h1, в предпросмотре — h2. */
  headingLevel?: 1 | 2
  numberLabel?: string
  children?: ReactNode
}

/** Вся пользовательская информация выводится как текст — React экранирует HTML. */
export function ExhibitView({ exhibit, onImageExpired, headingLevel = 1, numberLabel, children }: Props) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <article className="exhibit">
      <figure className="exhibit-figure">
        <ExhibitImage
          src={exhibit.imageUrl}
          alt={exhibit.imageAlt}
          width={exhibit.imageWidth}
          height={exhibit.imageHeight}
          onExpired={onImageExpired}
        />
      </figure>
      <div className="exhibit-body appear appear-delay">
        <p className="exhibit-number label">
          <span>{numberLabel ?? `Экспонат № ${formatNumber(exhibit.number)}`}</span>
          <span aria-hidden="true">Музей обычных вещей</span>
        </p>
        <Heading className="exhibit-title">{exhibit.title}</Heading>
        <p className="exhibit-story">{exhibit.story}</p>
        {(exhibit.keptSince || exhibit.authorName) && (
          <dl className="exhibit-meta">
            {exhibit.keptSince && (
              <>
                <dt>Хранится</dt>
                <dd>{exhibit.keptSince}</dd>
              </>
            )}
            {exhibit.authorName && (
              <>
                <dt>Из коллекции</dt>
                <dd>{exhibit.authorName}</dd>
              </>
            )}
          </dl>
        )}
        {children}
      </div>
    </article>
  )
}
