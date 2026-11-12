import { Link } from 'react-router'
import { useDocumentTitle } from '../lib/use-document-title.ts'

export function NotFoundPage() {
  useDocumentTitle('Страница не найдена')
  return (
    <div className="center-state">
      <p className="label">404</p>
      <h1>Такой страницы нет</h1>
      <Link to="/" className="btn">
        На главную
      </Link>
    </div>
  )
}
