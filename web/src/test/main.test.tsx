import { describe, it, expect, afterEach } from 'vitest';
import { selectPage } from '../main';
import { App } from '../App';
import { AdminApp } from '../AdminApp';
import { RenderApp } from '../RenderApp';

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('selectPage', () => {
  it('routes /admin to AdminApp', () => {
    expect(selectPage('/admin')).toBe(AdminApp);
  });

  it('routes / to App', () => {
    expect(selectPage('/')).toBe(App);
  });

  it('routes any other path to App', () => {
    expect(selectPage('/whatever')).toBe(App);
  });

  it('routes ?render=1 to RenderApp', () => {
    expect(selectPage('/', '?render=1')).toBe(RenderApp);
  });

  it('render param wins over /admin', () => {
    expect(selectPage('/admin', '?render=1')).toBe(RenderApp);
  });
});
