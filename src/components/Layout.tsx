import { useEffect, useRef, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { useApp } from '../lib/app-context.ts'

export function Layout({ children }: { children: ReactNode }) {
  const { config } = useApp()
  const { pathname } = useLocation()
  const first = useRef(true)

  // При смене маршрута переносим фокус на заголовок новой страницы —
  // скринридер озвучит, куда попал пользователь.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    window.scrollTo({ top: 0 })
    const id = requestAnimationFrame(() => {
      const h1 = document.querySelector<HTMLElement>('main h1')
      if (h1) {
        h1.setAttribute('tabindex', '-1')
        h1.focus({ preventScroll: true })
      }
    })
    return () => cancelAnimationFrame(id)
  }, [pathname])

  return (
    <div className="site">
      <a className="skip-link" href="#main">
        К содержанию
      </a>
      {config.mode === 'demo' && (
        <p className="demo-banner" role="note">
          <strong>Демо-версия.</strong> Экспонаты вымышлены, отправленные вещи никуда не сохраняются.
        </p>
      )}
      <header className="site-header">
        <Link to="/" className="wordmark">
          Музей обычных вещей
        </Link>
        <nav className="site-nav" aria-label="Основная навигация">
          <NavLink to="/exhibit">Смотреть</NavLink>
          <NavLink to="/submit">Добавить вещь</NavLink>
          <NavLink to="/about">О проекте</NavLink>
        </nav>
      </header>
      <main id="main" className="site-main">
        {children}
      </main>
      <footer className="site-footer">
        <span>Коллективный музей личных предметов</span>
        <nav aria-label="Служебные страницы">
          <Link to="/about">О проекте</Link>
          <Link to="/privacy">Приватность</Link>
        </nav>
      </footer>
    </div>
  )
}
