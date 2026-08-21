import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildAppPanelHosts, PluginSurface, resolvePanelLayout } from './panel-host'
import type { AppPanelProps, MySshPlugin } from './types'

const EmptyPanel = (() => null) as ComponentType<AppPanelProps>

function appPlugin(id: string, layout?: 'standard' | 'workspace'): MySshPlugin {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: id,
    panel: { title: id, scope: 'app', layout, Component: EmptyPanel }
  }
}

describe('plugin panel host contract', () => {
  it('defaults panels without an explicit layout to standard', () => {
    expect(resolvePanelLayout(appPlugin('legacy'))).toBe('standard')
    expect(resolvePanelLayout(appPlugin('mysql', 'workspace'))).toBe('workspace')
    expect(
      resolvePanelLayout({
        ...appPlugin('unknown'),
        panel: { ...appPlugin('unknown').panel!, layout: 'fullscreen' as 'workspace' }
      })
    ).toBe('standard')
  })

  it('mounts app panels lazily and keeps visited panels after switching', () => {
    const plugins = [
      appPlugin('mysql', 'workspace'),
      appPlugin('metrics'),
      {
        ...appPlugin('session-only'),
        panel: { ...appPlugin('session-only').panel!, scope: 'session' as const }
      }
    ]

    expect(buildAppPanelHosts(plugins, null, new Set())).toEqual([])
    expect(buildAppPanelHosts(plugins, 'mysql', new Set(['mysql']))).toEqual([
      { plugin: plugins[0], active: true }
    ])
    expect(buildAppPanelHosts(plugins, 'metrics', new Set(['mysql', 'metrics']))).toEqual([
      { plugin: plugins[0], active: false },
      { plugin: plugins[1], active: true }
    ])
  })

  it('renders the stable plugin surface attributes for legacy and workspace panels', () => {
    expect(
      renderToStaticMarkup(createElement(PluginSurface, { plugin: appPlugin('legacy') }, 'legacy'))
    ).toContain('class="plugin-surface" data-plugin-id="legacy" data-plugin-layout="standard"')
    expect(
      renderToStaticMarkup(createElement(PluginSurface, { plugin: appPlugin('mysql', 'workspace') }, 'mysql'))
    ).toContain('data-plugin-layout="workspace"')
  })
})
