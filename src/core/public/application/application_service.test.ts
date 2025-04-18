/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * The OpenSearch Contributors require contributions made to
 * this file be licensed under the Apache-2.0 license or a
 * compatible open source license.
 *
 * Any modifications Copyright OpenSearch Contributors. See
 * GitHub history for details.
 */

/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import {
  MockCapabilitiesService,
  MockHistory,
  parseAppUrlMock,
} from './application_service.test.mocks';

import { createElement } from 'react';
import { BehaviorSubject, Subject, Observable } from 'rxjs';
import { bufferCount, take, takeUntil } from 'rxjs/operators';
import { shallow, mount } from 'enzyme';

import { contextServiceMock } from '../context/context_service.mock';
import { httpServiceMock } from '../http/http_service.mock';
import { overlayServiceMock } from '../overlays/overlay_service.mock';
import { MockLifecycle } from './test_types';
import { ApplicationService } from './application_service';
import {
  App,
  PublicAppInfo,
  AppNavLinkStatus,
  AppStatus,
  AppUpdater,
  WorkspaceAvailability,
  InternalApplicationStart,
} from './types';
import { MountPoint } from '../types';
import { act } from 'react-dom/test-utils';
import { workspacesServiceMock } from '../mocks';

const createApp = (props: Partial<App>): App => {
  return {
    id: 'some-id',
    title: 'some-title',
    description: 'some-description',
    mount: () => () => undefined,
    ...props,
  };
};

let setupDeps: MockLifecycle<'setup'>;
let startDeps: MockLifecycle<'start'>;
let service: ApplicationService;

describe('#setup()', () => {
  beforeEach(() => {
    const http = httpServiceMock.createSetupContract({ basePath: '/base-path' });
    setupDeps = {
      http,
      context: contextServiceMock.createSetupContract(),
      redirectTo: jest.fn(),
    };
    startDeps = {
      http,
      overlays: overlayServiceMock.createStartContract(),
      workspaces: workspacesServiceMock.createStartContract(),
    };
    service = new ApplicationService();
  });

  describe('register', () => {
    it('throws an error if two apps with the same id are registered', () => {
      const { register } = service.setup(setupDeps);

      register(Symbol(), createApp({ id: 'app1' }));
      expect(() =>
        register(Symbol(), createApp({ id: 'app1' }))
      ).toThrowErrorMatchingInlineSnapshot(
        `"An application is already registered with the id \\"app1\\""`
      );
    });

    it('throws error if additional apps are registered after setup', async () => {
      const { register } = service.setup(setupDeps);

      await service.start(startDeps);
      expect(() =>
        register(Symbol(), createApp({ id: 'app1' }))
      ).toThrowErrorMatchingInlineSnapshot(`"Applications cannot be registered after \\"setup\\""`);
    });

    it('allows to register an AppUpdater for the application', async () => {
      const setup = service.setup(setupDeps);

      const pluginId = Symbol('plugin');
      const updater$ = new BehaviorSubject<AppUpdater>((app) => ({}));
      setup.register(pluginId, createApp({ id: 'app1', updater$ }));
      setup.register(pluginId, createApp({ id: 'app2' }));
      const { applications$ } = await service.start(startDeps);

      let applications = await applications$.pipe(take(1)).toPromise();
      expect(applications.size).toEqual(2);
      expect(applications.get('app1')).toEqual(
        expect.objectContaining({
          id: 'app1',
          navLinkStatus: AppNavLinkStatus.visible,
          status: AppStatus.accessible,
        })
      );
      expect(applications.get('app2')).toEqual(
        expect.objectContaining({
          id: 'app2',
          navLinkStatus: AppNavLinkStatus.visible,
          status: AppStatus.accessible,
        })
      );

      updater$.next((app) => ({
        status: AppStatus.inaccessible,
        tooltip: 'App inaccessible due to reason',
        defaultPath: 'foo/bar',
      }));

      applications = await applications$.pipe(take(1)).toPromise();
      expect(applications.size).toEqual(2);
      expect(applications.get('app1')).toEqual(
        expect.objectContaining({
          id: 'app1',
          navLinkStatus: AppNavLinkStatus.hidden,
          status: AppStatus.inaccessible,
          defaultPath: 'foo/bar',
          tooltip: 'App inaccessible due to reason',
        })
      );
      expect(applications.get('app2')).toEqual(
        expect.objectContaining({
          id: 'app2',
          navLinkStatus: AppNavLinkStatus.visible,
          status: AppStatus.accessible,
          description: 'some-description',
        })
      );
    });

    it('throws an error if an App with the same appRoute is registered', () => {
      const { register } = service.setup(setupDeps);

      register(Symbol(), createApp({ id: 'app1' }));

      expect(() =>
        register(Symbol(), createApp({ id: 'app2', appRoute: '/app/app1' }))
      ).toThrowErrorMatchingInlineSnapshot(
        `"An application is already registered with the appRoute \\"/app/app1\\""`
      );

      register(Symbol(), createApp({ id: 'app-next', appRoute: '/app/app3' }));

      expect(() =>
        register(Symbol(), createApp({ id: 'app2', appRoute: '/app/app3' }))
      ).toThrowErrorMatchingInlineSnapshot(
        `"An application is already registered with the appRoute \\"/app/app3\\""`
      );
    });

    it('throws an error if an App starts with the HTTP base path', () => {
      const { register } = service.setup(setupDeps);

      expect(() =>
        register(Symbol(), createApp({ id: 'app2', appRoute: '/base-path/app2' }))
      ).toThrowErrorMatchingInlineSnapshot(
        `"Cannot register an application route that includes HTTP base path"`
      );

      expect(() =>
        register(Symbol(), createApp({ id: 'app3', appRoute: '/base-path-i-am-not' }))
      ).not.toThrow();
    });
  });

  describe('registerAppUpdater', () => {
    it('updates status fields', async () => {
      const setup = service.setup(setupDeps);

      const pluginId = Symbol('plugin');
      setup.register(pluginId, createApp({ id: 'app1' }));
      setup.register(pluginId, createApp({ id: 'app2' }));
      setup.registerAppUpdater(
        new BehaviorSubject<AppUpdater>((app) => {
          if (app.id === 'app1') {
            return {
              status: AppStatus.inaccessible,
              navLinkStatus: AppNavLinkStatus.disabled,
              tooltip: 'App inaccessible due to reason',
            };
          }
          return {
            tooltip: 'App accessible',
          };
        })
      );
      const start = await service.start(startDeps);
      const applications = await start.applications$.pipe(take(1)).toPromise();

      expect(applications.size).toEqual(2);
      expect(applications.get('app1')).toEqual(
        expect.objectContaining({
          id: 'app1',
          navLinkStatus: AppNavLinkStatus.disabled,
          status: AppStatus.inaccessible,
          tooltip: 'App inaccessible due to reason',
        })
      );
      expect(applications.get('app2')).toEqual(
        expect.objectContaining({
          id: 'app2',
          navLinkStatus: AppNavLinkStatus.visible,
          status: AppStatus.accessible,
          tooltip: 'App accessible',
        })
      );
    });

    it(`properly combine with application's updater$`, async () => {
      const setup = service.setup(setupDeps);
      const pluginId = Symbol('plugin');
      const appStatusUpdater$ = new BehaviorSubject<AppUpdater>((app) => ({
        status: AppStatus.inaccessible,
        navLinkStatus: AppNavLinkStatus.disabled,
      }));
      setup.register(pluginId, createApp({ id: 'app1', updater$: appStatusUpdater$ }));
      setup.register(pluginId, createApp({ id: 'app2' }));

      setup.registerAppUpdater(
        new BehaviorSubject<AppUpdater>((app) => {
          if (app.id === 'app1') {
            return {
              status: AppStatus.accessible,
              tooltip: 'App inaccessible due to reason',
            };
          }
          return {
            status: AppStatus.inaccessible,
            navLinkStatus: AppNavLinkStatus.hidden,
          };
        })
      );

      const { applications$ } = await service.start(startDeps);
      const applications = await applications$.pipe(take(1)).toPromise();

      expect(applications.size).toEqual(2);
      expect(applications.get('app1')).toEqual(
        expect.objectContaining({
          id: 'app1',
          navLinkStatus: AppNavLinkStatus.disabled,
          status: AppStatus.inaccessible,
          tooltip: 'App inaccessible due to reason',
        })
      );
      expect(applications.get('app2')).toEqual(
        expect.objectContaining({
          id: 'app2',
          status: AppStatus.inaccessible,
          navLinkStatus: AppNavLinkStatus.hidden,
        })
      );
    });

    it('applies the most restrictive status in case of multiple updaters', async () => {
      const setup = service.setup(setupDeps);

      const pluginId = Symbol('plugin');
      setup.register(pluginId, createApp({ id: 'app1' }));
      setup.registerAppUpdater(
        new BehaviorSubject<AppUpdater>((app) => {
          return {
            status: AppStatus.inaccessible,
            navLinkStatus: AppNavLinkStatus.disabled,
          };
        })
      );
      setup.registerAppUpdater(
        new BehaviorSubject<AppUpdater>((app) => {
          return {
            status: AppStatus.accessible,
            navLinkStatus: AppNavLinkStatus.default,
          };
        })
      );

      const start = await service.start(startDeps);
      const applications = await start.applications$.pipe(take(1)).toPromise();

      expect(applications.size).toEqual(1);
      expect(applications.get('app1')).toEqual(
        expect.objectContaining({
          id: 'app1',
          navLinkStatus: AppNavLinkStatus.disabled,
          status: AppStatus.inaccessible,
        })
      );
    });

    it('emits on applications$ when a status updater changes', async () => {
      const setup = service.setup(setupDeps);

      const pluginId = Symbol('plugin');
      setup.register(pluginId, createApp({ id: 'app1' }));

      const statusUpdater = new BehaviorSubject<AppUpdater>((app) => {
        return {
          status: AppStatus.inaccessible,
          navLinkStatus: AppNavLinkStatus.disabled,
        };
      });
      setup.registerAppUpdater(statusUpdater);

      const start = await service.start(startDeps);
      let latestValue: ReadonlyMap<string, PublicAppInfo> = new Map<string, PublicAppInfo>();
      start.applications$.subscribe((apps) => {
        latestValue = apps;
      });

      expect(latestValue.get('app1')).toEqual(
        expect.objectContaining({
          id: 'app1',
          status: AppStatus.inaccessible,
          navLinkStatus: AppNavLinkStatus.disabled,
        })
      );

      statusUpdater.next((app) => {
        return {
          status: AppStatus.accessible,
          navLinkStatus: AppNavLinkStatus.hidden,
        };
      });

      expect(latestValue.get('app1')).toEqual(
        expect.objectContaining({
          id: 'app1',
          status: AppStatus.accessible,
          navLinkStatus: AppNavLinkStatus.hidden,
        })
      );
    });

    it('allows to update the basePath', async () => {
      const setup = service.setup(setupDeps);

      const pluginId = Symbol('plugin');
      setup.register(pluginId, createApp({ id: 'app1' }));

      const updater = new BehaviorSubject<AppUpdater>((app) => ({}));
      setup.registerAppUpdater(updater);

      const start = await service.start(startDeps);
      await start.navigateToApp('app1');
      expect(MockHistory.push).toHaveBeenCalledWith('/app/app1', undefined);
      MockHistory.push.mockClear();

      updater.next((app) => ({ defaultPath: 'default-path' }));
      await start.navigateToApp('app1');
      expect(MockHistory.push).toHaveBeenCalledWith('/app/app1/default-path', undefined);
      MockHistory.push.mockClear();

      updater.next((app) => ({ defaultPath: 'another-path' }));
      await start.navigateToApp('app1');
      expect(MockHistory.push).toHaveBeenCalledWith('/app/app1/another-path', undefined);
      MockHistory.push.mockClear();

      updater.next((app) => ({}));
      await start.navigateToApp('app1');
      expect(MockHistory.push).toHaveBeenCalledWith('/app/app1', undefined);
      MockHistory.push.mockClear();
    });
  });

  it("`registerMountContext` calls context container's registerContext", () => {
    const { registerMountContext } = service.setup(setupDeps);
    const container = setupDeps.context.createContextContainer.mock.results[0].value;
    const pluginId = Symbol();

    const appMount = () => () => undefined;
    registerMountContext(pluginId, 'test' as any, appMount);
    expect(container.registerContext).toHaveBeenCalledWith(pluginId, 'test', appMount);
  });
});

describe('#start()', () => {
  beforeEach(() => {
    const http = httpServiceMock.createSetupContract({ basePath: '/base-path' });
    setupDeps = {
      http,
      context: contextServiceMock.createSetupContract(),
      redirectTo: jest.fn(),
    };
    startDeps = {
      http,
      overlays: overlayServiceMock.createStartContract(),
      workspaces: workspacesServiceMock.createStartContract(),
    };
    service = new ApplicationService();
  });

  afterEach(() => {
    MockHistory.push.mockReset();
    MockHistory.replace.mockReset();
    parseAppUrlMock.mockReset();
  });

  it('rejects if called prior to #setup()', async () => {
    await expect(service.start(startDeps)).rejects.toThrowErrorMatchingInlineSnapshot(
      `"ApplicationService#setup() must be invoked before start."`
    );
  });

  it('exposes available apps', async () => {
    const { register } = service.setup(setupDeps);

    register(Symbol(), createApp({ id: 'app1' }));
    register(Symbol(), createApp({ id: 'app2' }));

    const { applications$ } = await service.start(startDeps);
    const availableApps = await applications$.pipe(take(1)).toPromise();

    expect(availableApps.size).toEqual(2);
    expect([...availableApps.keys()]).toEqual(['app1', 'app2']);
    expect(availableApps.get('app1')).toEqual(
      expect.objectContaining({
        appRoute: '/app/app1',
        id: 'app1',
        navLinkStatus: AppNavLinkStatus.visible,
        status: AppStatus.accessible,
      })
    );
    expect(availableApps.get('app2')).toEqual(
      expect.objectContaining({
        appRoute: '/app/app2',
        id: 'app2',
        navLinkStatus: AppNavLinkStatus.visible,
        status: AppStatus.accessible,
      })
    );
  });

  it('passes appIds to capabilities', async () => {
    const { register } = service.setup(setupDeps);

    register(Symbol(), createApp({ id: 'app1' }));
    register(Symbol(), createApp({ id: 'app2' }));
    register(Symbol(), createApp({ id: 'app3' }));
    await service.start(startDeps);

    expect(MockCapabilitiesService.start).toHaveBeenCalledWith({
      appIds: ['app1', 'app2', 'app3'],
      http: setupDeps.http,
    });
  });

  it('filters available applications based on capabilities', async () => {
    MockCapabilitiesService.start.mockResolvedValueOnce({
      capabilities: {
        navLinks: {
          app1: true,
          app2: false,
        },
      },
    } as any);

    const { register } = service.setup(setupDeps);

    register(Symbol(), createApp({ id: 'app1' }));
    register(Symbol(), createApp({ id: 'app2' }));

    const { applications$ } = await service.start(startDeps);
    const availableApps = await applications$.pipe(take(1)).toPromise();

    expect([...availableApps.keys()]).toEqual(['app1']);
  });

  describe('getComponent', () => {
    it('returns renderable JSX tree', async () => {
      service.setup(setupDeps);

      const { getComponent } = await service.start(startDeps);

      expect(() => shallow(createElement(getComponent))).not.toThrow();
      expect(getComponent()).toMatchSnapshot();
    });
  });

  describe('getUrlForApp', () => {
    it('creates URL for unregistered appId', async () => {
      service.setup(setupDeps);

      const { getUrlForApp } = await service.start(startDeps);

      expect(getUrlForApp('app1')).toBe('/base-path/app/app1');
    });

    it('creates URL for registered appId', async () => {
      const { register } = service.setup(setupDeps);

      register(Symbol(), createApp({ id: 'app1' }));
      register(Symbol(), createApp({ id: 'app2', appRoute: '/custom/path' }));

      const { getUrlForApp } = await service.start(startDeps);

      expect(getUrlForApp('app1')).toBe('/base-path/app/app1');
      expect(getUrlForApp('app2')).toBe('/base-path/custom/path');
    });

    it('creates URLs with path parameter', async () => {
      service.setup(setupDeps);
      const { getUrlForApp } = await service.start(startDeps);

      expect(getUrlForApp('app1', { path: 'deep/link' })).toBe('/base-path/app/app1/deep/link');
      expect(getUrlForApp('app1', { path: '/deep//link/' })).toBe('/base-path/app/app1/deep/link');
      expect(getUrlForApp('app1', { path: '//deep/link//' })).toBe('/base-path/app/app1/deep/link');
      expect(getUrlForApp('app1', { path: 'deep/link///' })).toBe('/base-path/app/app1/deep/link');
    });

    it('does not append trailing slash if hash is provided in path parameter', async () => {
      service.setup(setupDeps);
      const { getUrlForApp } = await service.start(startDeps);

      expect(getUrlForApp('app1', { path: '#basic-hash' })).toBe('/base-path/app/app1#basic-hash');
      expect(getUrlForApp('app1', { path: '#/hash/router/path' })).toBe(
        '/base-path/app/app1#/hash/router/path'
      );
    });

    it('creates absolute URLs when `absolute` parameter is true', async () => {
      service.setup(setupDeps);
      const { getUrlForApp } = await service.start(startDeps);

      expect(getUrlForApp('app1', { absolute: true })).toBe('http://localhost/base-path/app/app1');
      expect(getUrlForApp('app2', { path: 'deep/link', absolute: true })).toBe(
        'http://localhost/base-path/app/app2/deep/link'
      );
    });

    it('creates URL when the app is not accessible in a workspace', async () => {
      const httpMock = httpServiceMock.createSetupContract({
        basePath: '/base-path',
        clientBasePath: '/client-base-path',
      });
      const { register } = service.setup({
        ...setupDeps,
        http: httpMock,
      });
      // register a app that can only be accessed out of a workspace
      register(
        Symbol(),
        createApp({
          id: 'app1',
          workspaceAvailability: WorkspaceAvailability.outsideWorkspace,
        })
      );
      const { getUrlForApp } = await service.start({
        ...startDeps,
        http: httpMock,
      });

      expect(getUrlForApp('app1')).toBe('/base-path/app/app1');
      expect(getUrlForApp('app2')).toBe('/base-path/client-base-path/app/app2');
    });
  });

  describe('navigateToApp', () => {
    it('changes the browser history to /app/:appId', async () => {
      service.setup(setupDeps);

      const { navigateToApp } = await service.start(startDeps);

      await navigateToApp('myTestApp');
      expect(MockHistory.push).toHaveBeenCalledWith('/app/myTestApp', undefined);

      await navigateToApp('myOtherApp');
      expect(MockHistory.push).toHaveBeenCalledWith('/app/myOtherApp', undefined);
    });

    it('changes the browser history for custom appRoutes', async () => {
      const { register } = service.setup(setupDeps);

      register(Symbol(), createApp({ id: 'app2', appRoute: '/custom/path' }));

      const { navigateToApp } = await service.start(startDeps);

      await navigateToApp('myTestApp');
      expect(MockHistory.push).toHaveBeenCalledWith('/app/myTestApp', undefined);

      await navigateToApp('app2');
      expect(MockHistory.push).toHaveBeenCalledWith('/custom/path', undefined);
    });

    it('appends a path if specified', async () => {
      const { register } = service.setup(setupDeps);

      register(Symbol(), createApp({ id: 'app2', appRoute: '/custom/path' }));

      const { navigateToApp } = await service.start(startDeps);

      await navigateToApp('myTestApp', { path: 'deep/link/to/location/2' });
      expect(MockHistory.push).toHaveBeenCalledWith(
        '/app/myTestApp/deep/link/to/location/2',
        undefined
      );

      await navigateToApp('app2', { path: 'deep/link/to/location/2' });
      expect(MockHistory.push).toHaveBeenCalledWith(
        '/custom/path/deep/link/to/location/2',
        undefined
      );
    });

    it('appends a path if specified with hash', async () => {
      const { register } = service.setup(setupDeps);

      register(Symbol(), createApp({ id: 'app2', appRoute: '/custom/path' }));

      const { navigateToApp } = await service.start(startDeps);

      await navigateToApp('myTestApp', { path: '#basic-hash' });
      expect(MockHistory.push).toHaveBeenCalledWith('/app/myTestApp#basic-hash', undefined);

      await navigateToApp('myTestApp', { path: '#/hash/router/path' });
      expect(MockHistory.push).toHaveBeenCalledWith('/app/myTestApp#/hash/router/path', undefined);

      await navigateToApp('app2', { path: '#basic-hash' });
      expect(MockHistory.push).toHaveBeenCalledWith('/custom/path#basic-hash', undefined);

      await navigateToApp('app2', { path: '#/hash/router/path' });
      expect(MockHistory.push).toHaveBeenCalledWith('/custom/path#/hash/router/path', undefined);
    });

    it('preserves trailing slash when path contains a hash', async () => {
      const { register } = service.setup(setupDeps);

      register(Symbol(), createApp({ id: 'app2', appRoute: '/custom/app-path' }));

      const { navigateToApp } = await service.start(startDeps);
      await navigateToApp('app2', { path: '#/' });
      expect(MockHistory.push).toHaveBeenCalledWith('/custom/app-path#/', undefined);
      MockHistory.push.mockClear();

      await navigateToApp('app2', { path: '#/foo/bar/' });
      expect(MockHistory.push).toHaveBeenCalledWith('/custom/app-path#/foo/bar/', undefined);
      MockHistory.push.mockClear();

      await navigateToApp('app2', { path: '/path#/' });
      expect(MockHistory.push).toHaveBeenCalledWith('/custom/app-path/path#/', undefined);
      MockHistory.push.mockClear();

      await navigateToApp('app2', { path: '/path#/hash/' });
      expect(MockHistory.push).toHaveBeenCalledWith('/custom/app-path/path#/hash/', undefined);
      MockHistory.push.mockClear();

      await navigateToApp('app2', { path: '/path/' });
      expect(MockHistory.push).toHaveBeenCalledWith('/custom/app-path/path', undefined);
      MockHistory.push.mockClear();
    });

    it('appends the defaultPath when the path parameter is not specified', async () => {
      const { register } = service.setup(setupDeps);

      register(Symbol(), createApp({ id: 'app1', defaultPath: 'default/path' }));
      register(
        Symbol(),
        createApp({ id: 'app2', appRoute: '/custom-app-path', defaultPath: '/my-base' })
      );

      const { navigateToApp } = await service.start(startDeps);

      await navigateToApp('app1', { path: 'defined-path' });
      expect(MockHistory.push).toHaveBeenCalledWith('/app/app1/defined-path', undefined);

      await navigateToApp('app1', {});
      expect(MockHistory.push).toHaveBeenCalledWith('/app/app1/default/path', undefined);

      await navigateToApp('app2', { path: 'defined-path' });
      expect(MockHistory.push).toHaveBeenCalledWith('/custom-app-path/defined-path', undefined);

      await navigateToApp('app2', {});
      expect(MockHistory.push).toHaveBeenCalledWith('/custom-app-path/my-base', undefined);
    });

    it('includes state if specified', async () => {
      const { register } = service.setup(setupDeps);

      register(Symbol(), createApp({ id: 'app2', appRoute: '/custom/path' }));

      const { navigateToApp } = await service.start(startDeps);

      await navigateToApp('myTestApp', { state: 'my-state' });
      expect(MockHistory.push).toHaveBeenCalledWith('/app/myTestApp', 'my-state');

      await navigateToApp('app2', { state: 'my-state' });
      expect(MockHistory.push).toHaveBeenCalledWith('/custom/path', 'my-state');
    });

    it('updates currentApp$ after mounting', async () => {
      service.setup(setupDeps);

      const { currentAppId$, navigateToApp } = await service.start(startDeps);
      const stop$ = new Subject();
      const promise = currentAppId$.pipe(bufferCount(4), takeUntil(stop$)).toPromise();

      await navigateToApp('alpha');
      await navigateToApp('beta');
      await navigateToApp('gamma');
      await navigateToApp('delta');
      stop$.next();

      const appIds = await promise;

      expect(appIds).toMatchInlineSnapshot(`
        Array [
          "alpha",
          "beta",
          "gamma",
          "delta",
        ]
      `);
    });

    it('updates httpLoadingCount$ while mounting', async () => {
      // Use a memory history so that mounting the component will work
      const { createMemoryHistory } = jest.requireActual('history');
      const history = createMemoryHistory();
      setupDeps.history = history;

      const flushPromises = () => new Promise((resolve) => setImmediate(resolve));
      // Create an app and a promise that allows us to control when the app completes mounting
      const createWaitingApp = (props: Partial<App>): [App, () => void] => {
        let finishMount: () => void;
        const mountPromise = new Promise((resolve) => (finishMount = resolve));
        const app = {
          id: 'some-id',
          title: 'some-title',
          mount: async () => {
            await mountPromise;
            return () => undefined;
          },
          ...props,
        };

        return [app, finishMount!];
      };

      // Create some dummy applications
      const { register } = service.setup(setupDeps);
      const [alphaApp, finishAlphaMount] = createWaitingApp({ id: 'alpha' });
      const [betaApp, finishBetaMount] = createWaitingApp({ id: 'beta' });
      register(Symbol(), alphaApp);
      register(Symbol(), betaApp);

      const { navigateToApp, getComponent } = await service.start(startDeps);
      const httpLoadingCount$ = startDeps.http.addLoadingCountSource.mock.calls[0][0];
      const stop$ = new Subject();
      const currentLoadingCount$ = new BehaviorSubject(0);
      httpLoadingCount$.pipe(takeUntil(stop$)).subscribe(currentLoadingCount$);
      const loadingPromise = httpLoadingCount$.pipe(bufferCount(5), takeUntil(stop$)).toPromise();
      mount(getComponent()!);

      await act(() => navigateToApp('alpha'));
      expect(currentLoadingCount$.value).toEqual(1);
      await act(async () => {
        finishAlphaMount();
        await flushPromises();
      });
      expect(currentLoadingCount$.value).toEqual(0);

      await act(() => navigateToApp('beta'));
      expect(currentLoadingCount$.value).toEqual(1);
      await act(async () => {
        finishBetaMount();
        await flushPromises();
      });
      expect(currentLoadingCount$.value).toEqual(0);

      stop$.next();
      const loadingCounts = await loadingPromise;
      expect(loadingCounts).toMatchInlineSnapshot(`
        Array [
          0,
          1,
          0,
          1,
          0,
        ]
      `);
    });

    it('refresh the page if navigate to a app not accessible within a workspace', async () => {
      // Save the original assign method
      const originalLocation = window.location;
      delete (window as any).location;

      // Mocking the window object
      window.location = {
        ...originalLocation,
        assign: jest.fn(),
      };

      const { register } = service.setup(setupDeps);
      // register a app that can only be accessed out of a workspace
      register(
        Symbol(),
        createApp({
          id: 'app1',
          workspaceAvailability: WorkspaceAvailability.outsideWorkspace,
        })
      );
      const workspaces = workspacesServiceMock.createStartContract();
      workspaces.currentWorkspaceId$.next('foo');
      const http = httpServiceMock.createStartContract({
        basePath: '/base-path',
        clientBasePath: '/client-base-path',
      });
      const { navigateToApp } = await service.start({
        ...startDeps,
        workspaces,
        http,
      });
      await navigateToApp('app1');

      expect(window.location.assign).toBeCalledWith('/base-path/app/app1');
      await navigateToApp('app2');
      // assign should not be called
      expect(window.location.assign).toBeCalledTimes(1);
      window.location = originalLocation;
    });

    describe('when `replace` option is true', () => {
      it('use `history.replace` instead of `history.push`', async () => {
        service.setup(setupDeps);

        const { navigateToApp } = await service.start(startDeps);

        await navigateToApp('myTestApp', { replace: true });
        expect(MockHistory.replace).toHaveBeenCalledWith('/app/myTestApp', undefined);

        await navigateToApp('myOtherApp', { replace: true });
        expect(MockHistory.replace).toHaveBeenCalledWith('/app/myOtherApp', undefined);
      });

      it('includes state if specified', async () => {
        const { register } = service.setup(setupDeps);

        register(Symbol(), createApp({ id: 'app2', appRoute: '/custom/path' }));

        const { navigateToApp } = await service.start(startDeps);

        await navigateToApp('myTestApp', { state: 'my-state', replace: true });
        expect(MockHistory.replace).toHaveBeenCalledWith('/app/myTestApp', 'my-state');

        await navigateToApp('app2', { state: 'my-state', replace: true });
        expect(MockHistory.replace).toHaveBeenCalledWith('/custom/path', 'my-state');
      });
      it('appends a path if specified', async () => {
        const { register } = service.setup(setupDeps);

        register(Symbol(), createApp({ id: 'app2', appRoute: '/custom/path' }));

        const { navigateToApp } = await service.start(startDeps);

        await navigateToApp('myTestApp', { path: 'deep/link/to/location/2', replace: true });
        expect(MockHistory.replace).toHaveBeenCalledWith(
          '/app/myTestApp/deep/link/to/location/2',
          undefined
        );

        await navigateToApp('app2', { path: 'deep/link/to/location/2', replace: true });
        expect(MockHistory.replace).toHaveBeenCalledWith(
          '/custom/path/deep/link/to/location/2',
          undefined
        );
      });
    });

    describe('when `replace` option is false', () => {
      it('behave as when the option is unspecified', async () => {
        service.setup(setupDeps);

        const { navigateToApp } = await service.start(startDeps);

        await navigateToApp('myTestApp', { replace: false });
        expect(MockHistory.push).toHaveBeenCalledWith('/app/myTestApp', undefined);

        await navigateToApp('myOtherApp', { replace: false });
        expect(MockHistory.push).toHaveBeenCalledWith('/app/myOtherApp', undefined);

        expect(MockHistory.replace).not.toHaveBeenCalled();
      });
    });
  });

  describe('navigateToUrl', () => {
    it('calls `redirectTo` when the url is not parseable', async () => {
      parseAppUrlMock.mockReturnValue(undefined);
      service.setup(setupDeps);
      const { navigateToUrl } = await service.start(startDeps);

      await navigateToUrl('/not-an-app-path');

      expect(MockHistory.push).not.toHaveBeenCalled();
      expect(setupDeps.redirectTo).toHaveBeenCalledWith('/not-an-app-path');
    });

    it('calls `navigateToApp` when the url is an internal app link', async () => {
      parseAppUrlMock.mockReturnValue({ app: 'foo', path: '/some-path' });
      service.setup(setupDeps);
      const { navigateToUrl } = await service.start(startDeps);

      await navigateToUrl('/an-app-path');

      expect(MockHistory.push).toHaveBeenCalledWith('/app/foo/some-path', undefined);
      expect(setupDeps.redirectTo).not.toHaveBeenCalled();
    });
  });

  describe('AppControls', () => {
    test.each(['Left', 'Center', 'Right', 'Badge', 'Description', 'Bottom'])(
      'records the App%sControls',
      async (container) => {
        const { register } = service.setup(setupDeps);

        register(Symbol(), createApp({ id: `app${container}` }));
        const appStart = await service.start(startDeps);
        const setControls = appStart[
          `setApp${container}Controls` as keyof InternalApplicationStart
        ] as (mount: MountPoint | undefined) => void;
        const currentControls$ = appStart[
          `current${container}Controls$` as keyof InternalApplicationStart
        ] as Observable<MountPoint | undefined>;

        const oldMountPoint = jest.fn();
        const expectedMountPoint = jest.fn();

        await appStart.navigateToApp(`app${container}`);
        setControls(oldMountPoint);
        setControls(expectedMountPoint);

        const mountPoint = await currentControls$.pipe(take(1)).toPromise();
        expect(mountPoint).toBe(expectedMountPoint);
      }
    );
  });
});

describe('#stop()', () => {
  let addListenerSpy: jest.SpyInstance;
  let removeListenerSpy: jest.SpyInstance;

  beforeEach(() => {
    addListenerSpy = jest.spyOn(window, 'addEventListener');
    removeListenerSpy = jest.spyOn(window, 'removeEventListener');

    MockHistory.push.mockReset();
    const http = httpServiceMock.createSetupContract({ basePath: '/test' });
    setupDeps = {
      http,
      context: contextServiceMock.createSetupContract(),
    };
    startDeps = {
      http,
      overlays: overlayServiceMock.createStartContract(),
      workspaces: workspacesServiceMock.createStartContract(),
    };
    service = new ApplicationService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes the beforeunload listener', async () => {
    service.setup(setupDeps);
    await service.start(startDeps);
    expect(addListenerSpy).toHaveBeenCalledTimes(1);
    expect(addListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    const handler = addListenerSpy.mock.calls[0][1];
    service.stop();
    expect(removeListenerSpy).toHaveBeenCalledTimes(1);
    expect(removeListenerSpy).toHaveBeenCalledWith('beforeunload', handler);
  });
});
