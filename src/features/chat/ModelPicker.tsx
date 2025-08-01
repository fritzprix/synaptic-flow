import { FC, useCallback, useMemo } from 'react';
import { Dropdown } from '../../components/ui';
import { useModelOptions } from '@/context/ModelProvider';
import { AIServiceProvider } from '@/lib/ai-service';

interface ModelPickerProps {
  className?: string;
}

const CompactModelPicker: FC<ModelPickerProps> = ({ className = '' }) => {
  const {
    modelId,
    provider,
    setProvider,
    setModel,
    isLoading,
    apiKeys,
    selectedModelData,
    providerOptions,
    modelOptions,
  } = useModelOptions();

  const apiKeyStatus = useMemo(() => {
    const key = apiKeys[provider];
    return {
      text: provider,
      configured: key && key.length > 0,
    };
  }, [provider, apiKeys]);

  const onProviderChange = useCallback(
    (newProvider: string) => {
      setProvider(newProvider as AIServiceProvider);
    },
    [setProvider],
  );

  const onModelChange = useCallback(
    (newModel: string) => {
      setModel(newModel);
    },
    [setModel],
  );

  if (isLoading) {
    return (
      <div
        className={`font-mono text-sm text-muted-foreground animate-pulse ${className}`}
      >
        [loading...]
      </div>
    );
  }

  return (
    <div
      className={`flex items-center space-x-2 bg-muted border border-primary/30 rounded-lg px-3 py-1 font-mono text-primary w-full max-w-lg mx-auto ${className}`}
    >
      {apiKeyStatus && (
        <div
          title={apiKeyStatus.text}
          className={`w-2 h-2 rounded-full flex-shrink-0 ${apiKeyStatus.configured ? 'bg-primary' : 'bg-yellow-500'}`}
        ></div>
      )}
      <Dropdown
        options={providerOptions}
        value={provider}
        placeholder="provider"
        onChange={onProviderChange}
        className="flex-shrink w-28"
      />
      <span className="text-muted-foreground">/</span>
      <Dropdown
        options={modelOptions}
        value={modelId}
        placeholder="model"
        onChange={onModelChange}
        disabled={!modelId || modelOptions.length === 0}
        className="flex-grow min-w-0"
      />
      {selectedModelData && (
        <div className="flex items-center space-x-1.5 flex-shrink-0">
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {selectedModelData.contextWindow / 1000}k
          </span>
          {selectedModelData.supportTools && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
              Tools
            </span>
          )}
          {selectedModelData.supportReasoning && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
              Reasoning
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// --- TERMINAL MODEL PICKER (refactored to match CompactModelPicker logic) ---
const TerminalModelPicker: FC<ModelPickerProps> = ({ className = '' }) => {
  const {
    modelId,
    provider,
    setProvider,
    setModel,
    isLoading,
    apiKeys,
    selectedModelData,
    providerOptions,
    modelOptions,
  } = useModelOptions();

  const apiKeyStatus = useMemo(() => {
    const key = apiKeys[provider];
    return {
      text: provider,
      configured: key && key.length > 0,
    };
  }, [provider, apiKeys]);

  const onProviderChange = useCallback(
    (newProvider: string) => {
      setProvider(newProvider as AIServiceProvider);
    },
    [setProvider],
  );

  const onModelChange = useCallback(
    (newModel: string) => {
      setModel(newModel);
    },
    [setModel],
  );

  if (isLoading) {
    return (
      <div
        className={`bg-muted border border-primary/30 rounded-lg p-4 font-mono text-primary w-full max-w-lg mx-auto flex items-center space-x-3 ${className}`}
      >
        <div className="animate-spin w-5 h-5 border-2 border-primary border-t-transparent rounded-full"></div>
        <span className="text-sm text-muted-foreground">
          Initializing LLM interface...
        </span>
      </div>
    );
  }

  return (
    <div
      className={`bg-muted/70 backdrop-blur-sm border border-primary/30 rounded-lg p-4 font-mono text-primary w-full max-w-lg mx-auto ${className}`}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[90px_1fr_auto] gap-3 items-center">
          <label className="text-sm text-primary">PROVIDER:</label>
          <Dropdown
            options={providerOptions}
            value={provider}
            placeholder="<select>"
            onChange={onProviderChange}
            className="w-28"
          />
          {apiKeyStatus && (
            <div
              className={`text-xs px-2 py-1 rounded font-bold ${apiKeyStatus.configured ? 'bg-primary/20 text-primary' : 'bg-yellow-500/20 text-yellow-400'}`}
            >
              {apiKeyStatus.text}
            </div>
          )}
        </div>
        <div className="grid grid-cols-[90px_1fr] gap-3 items-center">
          <label className="text-sm text-primary">MODEL:</label>
          <Dropdown
            options={modelOptions}
            value={modelId}
            placeholder={provider ? '<select>' : '...'}
            onChange={onModelChange}
            disabled={!provider || modelOptions.length === 0}
            className="min-w-0"
          />
        </div>
        {selectedModelData && (
          <div className="border-t border-primary/20 mt-4 pt-3 text-xs text-muted-foreground space-y-2">
            <div className="flex justify-between items-center">
              <span>
                CONTEXT:{' '}
                <span className="font-semibold text-primary">
                  {selectedModelData.contextWindow?.toLocaleString() || 'N/A'}
                </span>
              </span>
              <span>
                TOOLS:{' '}
                {selectedModelData.supportTools ? (
                  <span className="font-semibold text-primary">YES</span>
                ) : (
                  <span className="text-yellow-500">NO</span>
                )}
              </span>
              <span>
                REASONING:{' '}
                {selectedModelData.supportReasoning ? (
                  <span className="font-semibold text-primary">YES</span>
                ) : (
                  <span className="text-yellow-500">NO</span>
                )}
              </span>
            </div>
            <div className="flex justify-between items-center text-muted-foreground">
              <span>
                COST (IN):{' '}
                <span className="font-semibold text-muted-foreground">
                  ${(selectedModelData.cost?.input * 1000)?.toFixed(2) || '?'}
                </span>
                /Mtok
              </span>
              <span>
                COST (OUT):{' '}
                <span className="font-semibold text-muted-foreground">
                  ${(selectedModelData.cost?.output * 1000)?.toFixed(2) || '?'}
                </span>
                /Mtok
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export { CompactModelPicker, TerminalModelPicker };
