import { useEffect } from 'react';
import { Link, Outlet, createBrowserRouter, useLocation, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { actions } from './data/store';
import { TopBar } from './components/TopBar';
import { Overview } from './pages/Overview';
import { RobotDetail } from './pages/RobotDetail';
import { FloorPlan } from './pages/FloorPlan';

function Shell() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    actions.hover(null);
  }, [pathname]);
  return <Outlet />;
}

function NotFound() {
  return (
    <>
      <TopBar />
      <main className="wrap" style={{ paddingTop: 96, paddingBottom: 96 }}>
        <h1 className="headline" style={{ fontSize: 48, lineHeight: '52px', letterSpacing: '-0.035em' }}>
          This page does not exist. <span className="ctx">Check the address, or go back to the fleet.</span>
        </h1>
        <p style={{ marginTop: 24 }}><Link className="more" to="/">Fleet overview <span aria-hidden="true">›</span></Link></p>
      </main>
    </>
  );
}

/** Exported so tests can mount the same tree in a memory router. */
export const routes: RouteObject[] = [
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Overview /> },
      { path: '/robots/:id', element: <RobotDetail /> },
      { path: '/floor-plan', element: <FloorPlan /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}
