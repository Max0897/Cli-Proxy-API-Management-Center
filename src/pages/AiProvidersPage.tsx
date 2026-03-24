import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CodexSection, useProviderStats } from '@/components/providers';
import {
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type { ProviderKeyConfig } from '@/types';
import styles from './AiProvidersPage.module.scss';

export function AiProvidersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);
  const isCacheValid = useConfigStore((state) => state.isCacheValid);

  const hasMounted = useRef(false);
  const [loading, setLoading] = useState(() => !isCacheValid('codex-api-key'));
  const [error, setError] = useState('');
  const [codexConfigs, setCodexConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.codexApiKeys || []
  );
  const [configSwitchingKey, setConfigSwitchingKey] = useState<string | null>(null);

  const disableControls = connectionStatus !== 'connected';
  const isSwitching = Boolean(configSwitchingKey);

  const { keyStats, usageDetails, loadKeyStats, refreshKeyStats } = useProviderStats();

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
  };

  const syncCodexConfigs = useCallback(
    (nextList: ProviderKeyConfig[]) => {
      setCodexConfigs(nextList);
      updateConfigValue('codex-api-key', nextList);
      clearCache('codex-api-key');
    },
    [clearCache, updateConfigValue]
  );

  const loadConfigs = useCallback(async () => {
    const hasValidCache = isCacheValid('codex-api-key');
    if (!hasValidCache) {
      setLoading(true);
    }
    setError('');

    try {
      const [cachedResult, liveResult] = await Promise.allSettled([
        fetchConfig('codex-api-key'),
        providersApi.getCodexConfigs(),
      ]);

      const cachedList =
        cachedResult.status === 'fulfilled' && Array.isArray(cachedResult.value)
          ? (cachedResult.value as ProviderKeyConfig[])
          : null;
      const liveList =
        liveResult.status === 'fulfilled' && Array.isArray(liveResult.value)
          ? (liveResult.value as ProviderKeyConfig[])
          : null;

      if (liveList) {
        syncCodexConfigs(liveList);
        return;
      }

      if (cachedList) {
        setCodexConfigs(cachedList);
        return;
      }

      const failure =
        liveResult.status === 'rejected'
          ? liveResult.reason
          : cachedResult.status === 'rejected'
            ? cachedResult.reason
            : new Error(t('notification.refresh_failed'));
      throw failure;
    } catch (err: unknown) {
      const message = getErrorMessage(err) || t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fetchConfig, isCacheValid, syncCodexConfigs, t]);

  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    loadConfigs();
    void loadKeyStats().catch(() => {});
  }, [loadConfigs, loadKeyStats]);

  useEffect(() => {
    if (config?.codexApiKeys) {
      setCodexConfigs(config.codexApiKeys);
    }
  }, [config?.codexApiKeys]);

  useHeaderRefresh(refreshKeyStats);

  const openEditor = useCallback(
    (path: string) => {
      navigate(path, { state: { fromAiProviders: true } });
    },
    [navigate]
  );

  const setCodexEnabled = async (index: number, enabled: boolean) => {
    const current = codexConfigs[index];
    if (!current) return;

    const switchingKey = `codex:${current.apiKey}`;
    setConfigSwitchingKey(switchingKey);

    const previousList = codexConfigs;
    const nextExcluded = enabled
      ? withoutDisableAllModelsRule(current.excludedModels)
      : withDisableAllModelsRule(current.excludedModels);
    const nextItem: ProviderKeyConfig = { ...current, excludedModels: nextExcluded };
    const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

    syncCodexConfigs(nextList);

    try {
      await providersApi.saveCodexConfigs(nextList);
      showNotification(
        enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
        'success'
      );
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      syncCodexConfigs(previousList);
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setConfigSwitchingKey(null);
    }
  };

  const deleteCodexEntry = async (index: number) => {
    const entry = codexConfigs[index];
    if (!entry) return;

    showConfirmation({
      title: t('ai_providers.codex_delete_title', { defaultValue: 'Delete Codex Config' }),
      message: t('ai_providers.codex_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteCodexConfig(entry.apiKey);
          const next = codexConfigs.filter((_, idx) => idx !== index);
          syncCodexConfigs(next);
          showNotification(t('notification.codex_config_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('ai_providers.codex_title')}</h1>
      <div className={styles.content}>
        {error && <div className="error-box">{error}</div>}

        <div id="provider-codex">
          <CodexSection
            configs={codexConfigs}
            keyStats={keyStats}
            usageDetails={usageDetails}
            loading={loading}
            disableControls={disableControls}
            isSwitching={isSwitching}
            onAdd={() => openEditor('/ai-providers/codex/new')}
            onEdit={(index) => openEditor(`/ai-providers/codex/${index}`)}
            onDelete={(index) => void deleteCodexEntry(index)}
            onToggle={(index, enabled) => void setCodexEnabled(index, enabled)}
          />
        </div>
      </div>
    </div>
  );
}
