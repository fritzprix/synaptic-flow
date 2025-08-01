import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useAsyncFn } from 'react-use';
import { AIServiceProvider } from '../lib/ai-service';
import { dbService } from '../lib/db';
import { llmConfigManager } from '../lib/llm-config-manager';
import { getLogger } from '../lib/logger';
import SettingsModal from '@/features/settings/SettingsModal';

const logger = getLogger('SettingsContext');

interface ModelChoice {
  provider: AIServiceProvider;
  model: string;
}

export interface Settings {
  apiKeys: Record<AIServiceProvider, string>;
  preferredModel: ModelChoice;
  windowSize: number;
}

const DEFAULT_MODEL = llmConfigManager.recommendModel({});

export const DEFAULT_SETTING: Settings = {
  apiKeys: {} as Record<AIServiceProvider, string>,
  preferredModel: {
    provider: (DEFAULT_MODEL?.providerId || 'openai') as AIServiceProvider,
    model: DEFAULT_MODEL?.modelId || '',
  },
  windowSize: 20,
};

interface SettingsContextType {
  value: Settings;
  update: (settings: Partial<Settings>) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

interface SettingModalViewContextType {
  isOpen: boolean;
  toggleOpen: () => void;
}

export const SettingModalViewContext =
  createContext<SettingModalViewContextType>({
    isOpen: false,
    toggleOpen: () => {},
  });

export const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [openSettingModal, setOpenSettingModal] = useState(false);
  const [{ value, loading, error }, load] = useAsyncFn(async () => {
    try {
      const [apiKeysObject, preferredModelObject, windowSizeObject] =
        await Promise.all([
          dbService.objects.read('apiKeys'),
          dbService.objects.read('preferredModel'),
          dbService.objects.read('windowSize'),
        ]);
      const settings: Settings = {
        ...DEFAULT_SETTING,
        ...(apiKeysObject
          ? {
              apiKeys: apiKeysObject.value as Record<AIServiceProvider, string>,
            }
          : {}),
        ...(preferredModelObject
          ? { preferredModel: preferredModelObject.value as ModelChoice }
          : {}),
        ...(windowSizeObject != null
          ? { windowSize: windowSizeObject.value as number }
          : {}),
      };
      return settings;
    } catch (e) {
      logger.error('Failed to load settings', e);
      throw e;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Update method
  const update = useCallback(
    async (settings: Partial<Settings>) => {
      try {
        if (settings.apiKeys) {
          const newApiKeys = { ...(value?.apiKeys || {}), ...settings.apiKeys };
          await dbService.objects.upsert({ key: 'apiKeys', value: newApiKeys });
        }
        if (settings.preferredModel) {
          await dbService.objects.upsert({
            key: 'preferredModel',
            value: settings.preferredModel,
          });
        }
        if (settings.windowSize != null) {
          await dbService.objects.upsert({
            key: 'windowSize',
            value: settings.windowSize,
          });
        }
        await load();
      } catch (e) {
        logger.error('Failed to update settings', e);
        throw e;
      }
    },
    [load, value],
  );

  const contextValue: SettingsContextType = useMemo(() => {
    return {
      value: value || DEFAULT_SETTING,
      isLoading: loading,
      update,
      error: error ?? null,
    };
  }, [value, loading, update, error]);

  const modalViewContextValue: SettingModalViewContextType = useMemo(() => {
    return {
      isOpen: openSettingModal,
      toggleOpen: () => setOpenSettingModal((prev) => !prev),
    };
  }, []);

  return (
    <SettingModalViewContext.Provider value={modalViewContextValue}>
      <SettingsContext.Provider value={contextValue}>
        {children}
        <SettingsModal
          isOpen={openSettingModal}
          onClose={() => setOpenSettingModal((prev) => !prev)}
        />
      </SettingsContext.Provider>
    </SettingModalViewContext.Provider>
  );
}

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
