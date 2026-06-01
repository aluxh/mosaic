import { describe, it, expect, afterEach } from 'vitest';
import { selectPage } from '../main';
import { App } from '../App';
import { AdminApp } from '../AdminApp';

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
});
