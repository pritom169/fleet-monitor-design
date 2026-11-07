import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SITE_BY_KEY } from '@fleet/shared/sites';
import { fleet } from '../data/store';
import { fleetState, reported, T } from '../test/fixtures';
import { renderAt } from '../test/render';
import { AttentionCard, AttentionCards } from './AttentionCard';
import { BatteryGlyph } from './BatteryGlyph';
import { FilterPills } from './FilterPills';
import { SitePlan } from './SitePlan';
import { SearchBox, SiteSelector } from './SiteSelector';
import { StatusPill } from './StatusPill';

const s = fleetState();
const rr = (id: string) => reported(s, id);
const loc = () => screen.getByTestId('location').textContent;

describe('StatusPill and BatteryGlyph', () => {
  it('always shows a label with the icon', () => {
    for (const st of ['ok', 'low', 'error', 'offline', 'never'] as const) {
      const { container, unmount } = render(<><StatusPill status={st} /><StatusPill status={st} size="lg" solid /></>);
      expect(container.querySelectorAll('svg').length).toBe(2);
      unmount();
    }
    render(<StatusPill status="low" size="lg" />);
    expect(screen.getByText('Low Battery').querySelector('svg')!.getAttribute('width')).toBe('17');
  });

  it('clamps the battery fill', () => {
    const { container } = render(<><BatteryGlyph value={140} status="ok" /><BatteryGlyph value={-3} status="low" /><BatteryGlyph value={40} status="offline" /></>);
    const fills = [...container.querySelectorAll('[aria-hidden] > span:first-child')] as HTMLElement[];
    expect(fills.map((f) => f.style.width)).toEqual(['100%', '0%', '40%']);
  });
});

describe('AttentionCard', () => {
  it('shows the reason and context for each problem, and opens the robot on click', () => {
    renderAt(<>
      <AttentionCard robot={rr('R-002')} now={T} hovered stale={false} />
      <AttentionCard robot={rr('R-003')} now={T} hovered={false} stale />
      <AttentionCard robot={rr('R-004')} now={T} hovered={false} stale={false} />
    </>);
    expect(screen.getByText('14% battery')).toBeTruthy();
    expect(screen.getByText('Returning to dock · Hamburg DC')).toBeTruthy();
    expect(screen.getByText('Stopped · Hamburg DC')).toBeTruthy();
    expect(screen.getByText('Last seen 3 min 4 s ago')).toBeTruthy();
    expect(screen.getByText('Last task: Pick order #4433 · Hamburg DC')).toBeTruthy();
    fireEvent.click(screen.getByRole('heading', { name: 'R-003' }));
    expect(loc()).toBe('/robots/R-003');
  });

  it('lets the link do the navigation, and tracks hover', () => {
    renderAt(<AttentionCard robot={{ ...rr('R-002'), changedAt: T - 1000 }} now={T} hovered={false} stale={false} />);
    const card = screen.getByRole('article');
    fireEvent.mouseEnter(card);
    expect(fleet.get().hover).toEqual({ id: 'R-002', from: 'card' });
    fireEvent.mouseLeave(card);
    expect(fleet.get().hover).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'View details for R-002' }));
    expect(loc()).toBe('/robots/R-002');
  });

  it('renders nothing without problems, and folds more than 8 cards', () => {
    const { container } = renderAt(<AttentionCards robots={[]} now={T} hoveredId={null} stale={false} />);
    expect(container.querySelector('section')).toBeNull();
    const many = Array.from({ length: 10 }, (_, i) => ({ ...rr('R-002'), id: `R-1${i}` }));
    renderAt(<AttentionCards robots={many} now={T} hoveredId="R-10" stale={false} />);
    expect(screen.getAllByRole('article').length).toBe(7);
    expect(screen.getByText('+3 more')).toBeTruthy();
  });
});

describe('FilterPills', () => {
  const counts = { all: 7, ok: 2, low: 1, error: 1, offline: 2, never: 0 };

  it('hides "Never reported" when there are none, and toggles a filter back to all', () => {
    const onChange = vi.fn();
    render(<FilterPills counts={counts} value="low" onChange={onChange} showing="1 of 7" />);
    expect(screen.queryByRole('button', { name: /Never reported/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Low battery 1' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Low battery 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Error 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'All 7' }));
    expect(onChange.mock.calls).toEqual([['all'], ['error'], ['all']]);
    expect(screen.getByText('1 of 7')).toBeTruthy();
  });

  it('colours a count only above zero', () => {
    render(<FilterPills counts={{ ...counts, never: 1, low: 0 }} value="all" onChange={() => {}} showing="" />);
    const color = (name: RegExp) => (screen.getByRole('button', { name }).querySelector('span') as HTMLElement).style.color;
    expect(color(/^Low battery/)).toBe('var(--ink2)');
    expect(color(/^Error/)).toBe('var(--err-text)');
    expect(color(/^Offline/)).toBe('var(--ink)');
    expect(color(/^Never reported/)).toBe('var(--ink2)');
  });

  it('keeps the "Never reported" pill while it is selected, and shows dashes while loading', () => {
    render(<FilterPills counts={null} value="never" onChange={() => {}} showing="" loading />);
    const b = screen.getByRole('button', { name: 'Never reported —' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
  });
});

describe('SitePlan', () => {
  it('draws zones, racks, and in detail the charging bays and aisle labels', () => {
    const { container } = render(<SitePlan site={SITE_BY_KEY.le} detail emptyNote="Nothing here" />);
    expect(screen.getByText('Inbound')).toBeTruthy();
    expect(screen.getByText('B1')).toBeTruthy();
    expect(container.querySelectorAll('svg').length).toBe(4); // charging bays
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });

  it('leaves labels off the mini plan', () => {
    render(<SitePlan site={SITE_BY_KEY.hh} variant="mini" />);
    expect(screen.queryByText('Charging')).toBeNull();
  });
});

describe('SiteSelector and SearchBox', () => {
  it('offers every site, as tabs and as a menu', () => {
    const onChange = vi.fn();
    render(<SiteSelector value="le" onChange={onChange} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['All Sites', 'Hamburg DC', 'Leipzig Hub', 'Munich North', 'Berlin South']);
    fireEvent.click(screen.getByRole('button', { name: 'Munich North' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Site' }), { target: { value: 'all' } });
    expect(onChange.mock.calls).toEqual([['mu'], ['all']]);
  });

  it('focuses on "/", clears on Escape, and leaves "/" alone inside inputs', () => {
    const onChange = vi.fn();
    render(<><SearchBox value="r-0" onChange={onChange} /><textarea aria-label="notes" /></>);
    const input = screen.getByRole('searchbox');
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'r-01' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange.mock.calls).toEqual([['r-01'], ['']]);
    expect(document.activeElement).not.toBe(input);
    const notes = screen.getByRole('textbox', { name: 'notes' });
    notes.focus();
    fireEvent.keyDown(notes, { key: '/' });
    expect(document.activeElement).toBe(notes);
    fireEvent.keyDown(input, { key: 'a' });
    fireEvent.keyDown(window, { key: 'x' });
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
