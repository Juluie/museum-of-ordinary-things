import { Link } from 'react-router'

export function LoadingState({ text = 'Загружаем…' }: { text?: string }) {
  return (
    <div className="center-state" aria-busy="true">
      <h1 className="visually-hidden">Загрузка</h1>
      <p className="loading" role="status">
        {text}
      </p>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="center-state">
      <h1>Не получилось открыть экспонат</h1>
      <p className="notice notice-error" role="alert">
        {message}
      </p>
      <button type="button" className="btn" onClick={onRetry}>
        Попробовать ещё раз
      </button>
    </div>
  )
}

export function EmptyCollection() {
  return (
    <div className="center-state">
      <p className="label">Зал пока пуст</p>
      <h1>В музее ещё нет ни одной вещи</h1>
      <p className="muted">Можно стать первым экспонатом. Вещь появится после проверки.</p>
      <Link to="/submit" className="btn btn-primary">
        Добавить первую вещь
      </Link>
    </div>
  )
}

export function NotFoundExhibit() {
  return (
    <div className="center-state">
      <p className="label">Хранилище</p>
      <h1>Экспонат не найден</h1>
      <p className="muted">Возможно, ссылка неточная или экспонат больше не выставлен.</p>
      <div className="actions">
        <Link to="/exhibit" className="btn btn-primary">
          Посмотреть другой экспонат
        </Link>
        <Link to="/" className="btn btn-quiet">
          На главную
        </Link>
      </div>
    </div>
  )
}
