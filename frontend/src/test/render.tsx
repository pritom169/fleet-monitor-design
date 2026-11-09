import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

function Where() {
  const l = useLocation();
  return <div data-testid="location">{l.pathname + l.search}</div>;
}

export function renderAt(ui: ReactElement, path = '/', route = '*') {
  const wrap = (el: ReactElement) => (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={el} />
        {route !== '*' && <Route path="*" element={null} />}
      </Routes>
      <Where />
    </MemoryRouter>
  );
  const result = render(wrap(ui));
  return { ...result, rerender: (el: ReactElement) => result.rerender(wrap(el)) };
}
