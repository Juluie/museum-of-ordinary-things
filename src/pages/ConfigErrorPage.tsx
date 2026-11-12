// Показывается, если сайт собран в режиме live, но настройки неполные.
// Мы НЕ переключаемся молча на демо, чтобы посетитель не принял макет за настоящий музей.
export function ConfigErrorPage({ problems }: { problems: string[] }) {
  return (
    <main className="container center-state" id="main">
      <h1>Музей временно недоступен</h1>
      <p className="muted">Сайт настроен не до конца. Мы уже знаем об этом — загляни чуть позже.</p>
      {import.meta.env.DEV && (
        <div className="notice notice-error" role="alert">
          <strong>Для разработчика: проверь переменные окружения</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </main>
  )
}
