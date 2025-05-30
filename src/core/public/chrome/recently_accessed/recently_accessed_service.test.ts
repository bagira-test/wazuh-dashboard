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

import { httpServiceMock } from '../../http/http_service.mock';
import { workspacesServiceMock } from '../../mocks';
import { RecentlyAccessedService } from './recently_accessed_service';
import { Subject } from 'rxjs';
import { takeUntil, bufferCount } from 'rxjs/operators';

// Maybe this should be moved to our global jest polyfills?
class LocalStorageMock implements Storage {
  private store = new Map<string, string>();

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) || null;
  }

  setItem(key: string, value: any) {
    this.store.set(key, value.toString());
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  key(index: number) {
    return [...this.store.keys()][index] || null;
  }

  public get length() {
    return this.store.size;
  }
}

describe('RecentlyAccessed#start()', () => {
  let originalLocalStorage: Storage;
  let workspaceEnabled = false;
  beforeAll(() => {
    originalLocalStorage = window.localStorage;

    // @ts-expect-error to allow redeclaring a readonly prop
    delete window.localStorage;
    // @ts-expect-error
    window.localStorage = new LocalStorageMock();
  });
  beforeEach(() => localStorage.clear());
  // @ts-expect-error
  afterAll(() => (window.localStorage = originalLocalStorage));

  const getStart = async () => {
    const http = httpServiceMock.createStartContract();
    const workspaces = workspacesServiceMock.createStartContract();
    const application = {
      ...jest.requireActual('../../application'),
      capabilities: {
        workspaces: {
          enabled: workspaceEnabled,
        },
      },
    };
    const recentlyAccessed = await new RecentlyAccessedService().start({
      http,
      workspaces,
      application,
    });
    return { http, recentlyAccessed, workspaces };
  };

  it('allows adding and getting items', async () => {
    const { recentlyAccessed } = await getStart();
    recentlyAccessed.add('/app/item1', 'Item 1', 'item1');
    recentlyAccessed.add('/app/item2', 'Item 2', 'item2');
    expect(recentlyAccessed.get()).toEqual([
      { link: '/app/item2', label: 'Item 2', id: 'item2' },
      { link: '/app/item1', label: 'Item 1', id: 'item1' },
    ]);
  });

  it('persists data to localStorage', async () => {
    const { recentlyAccessed: ra1 } = await getStart();
    ra1.add('/app/item1', 'Item 1', 'item1');
    ra1.add('/app/item2', 'Item 2', 'item2');

    const { recentlyAccessed: ra2 } = await getStart();
    expect(ra2.get()).toEqual([
      { link: '/app/item2', label: 'Item 2', id: 'item2' },
      { link: '/app/item1', label: 'Item 1', id: 'item1' },
    ]);
  });

  it('de-duplicates the list', async () => {
    const { recentlyAccessed } = await getStart();
    recentlyAccessed.add('/app/item1', 'Item 1', 'item1');
    recentlyAccessed.add('/app/item2', 'Item 2', 'item2');
    recentlyAccessed.add('/app/item1', 'Item 1', 'item1');
    expect(recentlyAccessed.get()).toEqual([
      { link: '/app/item1', label: 'Item 1', id: 'item1' },
      { link: '/app/item2', label: 'Item 2', id: 'item2' },
    ]);
  });

  it('exposes an observable', async () => {
    const { recentlyAccessed } = await getStart();
    const stop$ = new Subject();
    const observedValues$ = recentlyAccessed
      .get$()
      .pipe(bufferCount(3), takeUntil(stop$))
      .toPromise();
    recentlyAccessed.add('/app/item1', 'Item 1', 'item1');
    recentlyAccessed.add('/app/item2', 'Item 2', 'item2');
    stop$.next();

    expect(await observedValues$).toMatchInlineSnapshot(`
Array [
  Array [],
  Array [
    Object {
      "id": "item1",
      "label": "Item 1",
      "link": "/app/item1",
    },
  ],
  Array [
    Object {
      "id": "item2",
      "label": "Item 2",
      "link": "/app/item2",
    },
    Object {
      "id": "item1",
      "label": "Item 1",
      "link": "/app/item1",
    },
  ],
]
`);
  });

  it('adding items with workspaceId if is inside a workspace', async () => {
    const { recentlyAccessed, workspaces } = await getStart();
    workspaces.currentWorkspaceId$.next('foo');
    recentlyAccessed.add('/app/item1', 'Item 1', 'item1');
    expect(recentlyAccessed.get()).toEqual([
      { link: '/app/item1', label: 'Item 1', id: 'item1', workspaceId: 'foo' },
    ]);
  });

  it('should not get objects without related workspace when workspace enabled', async () => {
    workspaceEnabled = true;

    const { recentlyAccessed } = await getStart();
    recentlyAccessed.add('/app/item1', 'Item 1', 'item1');
    expect(recentlyAccessed.get()).toEqual([]);
  });

  it('should get objects with related workspace when workspace enabled', async () => {
    workspaceEnabled = true;

    const { recentlyAccessed, workspaces } = await getStart();
    workspaces.currentWorkspaceId$.next('foo');
    recentlyAccessed.add('/app/item1', 'Item 1', 'item1');
    expect(recentlyAccessed.get()).toEqual([
      { link: '/app/item1', label: 'Item 1', id: 'item1', workspaceId: 'foo' },
    ]);
  });
});
