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

import { SavedObjectsClientContract } from '../saved_objects/types';
import {
  UiSettingsParams,
  UserProvidedValues,
  PublicUiSettingsParams,
  UiSettingScope,
} from '../../types';
export {
  UiSettingsParams,
  PublicUiSettingsParams,
  StringValidationRegexString,
  StringValidationRegex,
  StringValidation,
  DeprecationSettings,
  ImageValidation,
  UiSettingsType,
  UserProvidedValues,
  UiSettingScope,
} from '../../types';

/**
 * Server-side client that provides access to the advanced settings stored in opensearch.
 * The settings provide control over the behavior of the OpenSearch Dashboards application.
 * For example, a user can specify how to display numeric or date fields.
 * Users can adjust the settings via Management UI.
 *
 * @public
 */
export interface IUiSettingsClient {
  /**
   * Returns all registered uiSettings values {@link UiSettingsParams}
   */
  getRegistered: () => Readonly<Record<string, PublicUiSettingsParams>>;
  /**
   * Returns the overridden uiSettings value if one exists, or the registered default if one exists {@link UiSettingsParams}
   */
  getOverrideOrDefault: (key: string) => unknown;
  /**
   * Returns the registered default if one exists {@link UiSettingsParams}
   */
  getDefault: (key: string) => unknown;
  /**
   * Retrieves uiSettings values set by the user with fallbacks to default values if not specified.
   */
  get: <T = any>(key: string, scope?: UiSettingScope) => Promise<T>;
  /**
   * Retrieves a set of all uiSettings values set by the user with fallbacks to default values if not specified.
   */
  getAll: <T = any>(scope?: UiSettingScope) => Promise<Record<string, T>>;
  /**
   * Retrieves a set of all uiSettings values set by the user.
   */
  getUserProvided: <T = any>(
    scope?: UiSettingScope
  ) => Promise<Record<string, UserProvidedValues<T>>>;
  /**
   * Writes multiple uiSettings values and marks them as set by the user.
   */
  setMany: (changes: Record<string, any>, scope?: UiSettingScope) => Promise<void>;
  /**
   * Writes uiSettings value and marks it as set by the user.
   */
  set: (key: string, value: any, scope?: UiSettingScope) => Promise<void>;
  /**
   * Removes uiSettings value by key.
   */
  remove: (key: string, scope?: UiSettingScope) => Promise<void>;
  /**
   * Removes multiple uiSettings values by keys.
   */
  removeMany: (keys: string[], scope?: UiSettingScope) => Promise<void>;
  /**
   * Shows whether the uiSettings value set by the user.
   */
  isOverridden: (key: string) => boolean;
}

/** @internal */
export interface InternalUiSettingsServiceSetup {
  /**
   * Sets settings with default values for the uiSettings.
   * @param settings
   */
  register(settings: Record<string, UiSettingsParams>): void;
}

/** @public */
export interface UiSettingsServiceSetup {
  /**
   * Sets settings with default values for the uiSettings.
   * @param settings
   *
   * @example
   * ```ts
   * setup(core: CoreSetup){
   *  core.uiSettings.register([{
   *   foo: {
   *    name: i18n.translate('my foo settings'),
   *    value: true,
   *    description: 'add some awesomeness',
   *   },
   *  }]);
   * }
   * ```
   */
  register(settings: Record<string, UiSettingsParams>): void;
}

/** @public */
export interface UiSettingsServiceStart {
  /**
   * Creates a {@link IUiSettingsClient} with provided *scoped* saved objects client.
   *
   * This should only be used in the specific case where the client needs to be accessed
   * from outside of the scope of a {@link RequestHandler}.
   *
   * @example
   * ```ts
   * start(core: CoreStart) {
   *  const soClient = core.savedObjects.getScopedClient(arbitraryRequest);
   *  const uiSettingsClient = core.uiSettings.asScopedToClient(soClient);
   * }
   * ```
   */
  asScopedToClient(savedObjectsClient: SavedObjectsClientContract): IUiSettingsClient;
}

/** @internal */
export type InternalUiSettingsServiceStart = UiSettingsServiceStart;
