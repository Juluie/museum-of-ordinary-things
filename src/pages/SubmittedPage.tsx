import { Link, useLocation } from 'react-router'
import { useDocumentTitle } from '../lib/use-document-title.ts'

export function SubmittedPage() {
  const demo = (useLocation().state as { demo?: boolean } | null)?.demo === true
  useDocumentTitle(demo ? 'Тестовая отправка' : 'Вещь отправлена')

  if (demo) {
    return (
      <div className="center-state">
        <p className="label">Демо-режим</p>
        <h1>Это была тестовая отправка</h1>
        <p className="notice notice-demo" role="status">
          В демо-версии фото и история никуда не отправляются и не сохраняются. Форма и предпросмотр работают так же, как в
          настоящем музее.
        </p>
        <div className="actions">
          <Link to="/exhibit" className="btn btn-primary">
            Посмотреть экспонаты
          </Link>
          <Link to="/" className="btn btn-quiet">
            На главную
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="center-state">
      <p className="label">Принято на хранение</p>
      <h1>Твоя вещь отправлена в музей</h1>
      <p role="status">Она появится после проверки.</p>
      <div className="actions">
        <Link to="/exhibit" className="btn btn-primary">
          Посмотреть экспонаты
        </Link>
        <Link to="/" className="btn btn-quiet">
          На главную
        </Link>
      </div>
    </div>
  )
}
