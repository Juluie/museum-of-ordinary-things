import { Link } from 'react-router'
import { useDocumentTitle } from '../lib/use-document-title.ts'

export function HomePage() {
  useDocumentTitle(null)
  return (
    <section className="home" aria-labelledby="home-title">
      <h1 id="home-title" className="home-title appear">
        <span>Музей</span>
        <span>обычных вещей</span>
      </h1>
      <p className="home-subtitle appear appear-delay">
        Вещи, которые ничего не стоят для других, но много значат для нас.
      </p>
      <p className="home-text appear appear-delay">
        Здесь хранятся фотографии простых предметов и истории о том, почему их не выбрасывают. Открой
        случайный экспонат — или принеси свой.
      </p>
      <div className="actions appear appear-delay">
        <Link to="/exhibit" className="btn btn-primary">
          Посмотреть экспонат
        </Link>
        <Link to="/submit" className="btn">
          Добавить свою вещь
        </Link>
      </div>
      <p className="home-meta label appear appear-delay">
        <span>Вход свободный</span>
        <Link to="/about">О проекте</Link>
      </p>
    </section>
  )
}
