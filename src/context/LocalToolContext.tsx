import { MCPTool } from '@/lib/tauri-mcp-client';
import { Tool } from '@/models/chat';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAssistantContext } from './AssistantContext';
import { useScheduledCallback } from '@/hooks/use-scheduled-callback';

/**
 * Represents a single tool within a service, pairing its definition with its handler.
 * The handler returns a standard MCPResponse for protocol compliance.
 */
// MCP-compliant content types (from MCP spec)
export type MCPTextContent = {
  type: 'text';
  text: string;
  annotations?: Record<string, unknown>;
};

export type MCPImageContent = {
  type: 'image';
  data: string; // base64
  mimeType: string;
  annotations?: Record<string, unknown>;
};

export type MCPAudioContent = {
  type: 'audio';
  data: string; // base64
  mimeType: string;
  annotations?: Record<string, unknown>;
};

export type MCPResourceLinkContent = {
  type: 'resource_link';
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  annotations?: Record<string, unknown>;
};

export type MCPResourceContent = {
  type: 'resource';
  resource: {
    uri: string;
    title?: string;
    mimeType?: string;
    text?: string;
    annotations?: Record<string, unknown>;
  };
};

export type MCPContent =
  | MCPTextContent
  | MCPImageContent
  | MCPAudioContent
  | MCPResourceLinkContent
  | MCPResourceContent;

export interface MCPResult {
  content?: MCPContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  success: boolean;
  result?: MCPResult;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface ServiceTool {
  toolDefinition: MCPTool;
  handler: (args: unknown) => Promise<MCPResponse>;
}

/**
 * Defines a service, which is a collection of related tools.
 * This is the basic unit for registration.
 */
export interface LocalService {
  name: string; // Unique name for the service, e.g., "weatherService"
  tools: ServiceTool[];
}

/**
 * Defines the values provided by the LocalToolContext.
 * The API is updated to register/unregister services instead of individual tools.
 */
interface LocalToolContextType {
  registerService: (service: LocalService) => void;
  unregisterService: (serviceName: string) => void;
  getToolsByService: (serviceName: string) => MCPTool[];
  getAvailableServices: () => string[];
  getService: (serviceName: string) => LocalService | undefined;
  getToolByName: (toolName: string) => ServiceTool | undefined;
  getAvailableTools: () => Tool[];
  executeToolCall: (toolCall: {
    id: string;
    function: { name: string; arguments: string };
  }) => Promise<{ role: 'tool'; content: string; tool_call_id: string }>;
  availableTools: Tool[];
  isLocalTool: (toolName: string) => boolean;
}

const LocalToolContext = createContext<LocalToolContextType | null>(null);

export function LocalToolProvider({ children }: { children: React.ReactNode }) {
  // A ref to a Map that stores all registered services by name.
  const servicesRef = useRef<Map<string, LocalService>>(new Map());

  // A state variable to trigger re-renders when services change.
  const [version, setVersion] = useState(0);
  const forceUpdate = useCallback(() => setVersion((v) => v + 1), []);

  const registerService = useCallback(
    (service: LocalService) => {
      servicesRef.current.set(service.name, service);
      forceUpdate(); // Update UI when a service is registered
    },
    [forceUpdate],
  );

  const unregisterService = useCallback(
    (serviceName: string) => {
      servicesRef.current.delete(serviceName);
      forceUpdate(); // Update UI when a service is unregistered
    },
    [forceUpdate],
  );

  const getToolsByService = useCallback((serviceName: string) => {
    const service = servicesRef.current.get(serviceName);
    return service ? service.tools.map((t) => t.toolDefinition) : [];
  }, []);

  const getAvailableServices = useCallback(() => {
    return Array.from(servicesRef.current.keys());
  }, []);

  const getService = useCallback((serviceName: string) => {
    return servicesRef.current.get(serviceName);
  }, []);

  const getToolByName = useCallback((toolName: string) => {
    for (const service of servicesRef.current.values()) {
      const tool = service.tools.find(
        (t) => t.toolDefinition.name === toolName,
      );
      if (tool) {
        return tool;
      }
    }
    return undefined;
  }, []);

  const executeToolCall = useCallback(
    async (toolCall: {
      id: string;
      function: { name: string; arguments: string };
    }) => {
      const toolName = toolCall.function.name;
      // Search for the tool across all registered services and execute its handler.
      for (const service of servicesRef.current.values()) {
        const tool = service.tools.find(
          (t) => t.toolDefinition.name === toolName,
        );
        if (tool) {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await tool.handler(args);
            return {
              role: 'tool' as const,
              content: JSON.stringify(result ?? null),
              tool_call_id: toolCall.id,
            };
          } catch (error) {
            return {
              role: 'tool' as const,
              content: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`,
              tool_call_id: toolCall.id,
            };
          }
        }
      }
      return {
        role: 'tool' as const,
        content: `Error: Tool "${toolName}" not found.`,
        tool_call_id: toolCall.id,
      };
    },
    [],
  );

  const scheduledExecuteToolCall = useScheduledCallback(executeToolCall, [
    executeToolCall,
  ]);

  const { currentAssistant } = useAssistantContext();

  const allRegisteredTools = useMemo(() => {
    const allTools: MCPTool[] = [];
    for (const service of servicesRef.current.values()) {
      service.tools.forEach((t) => allTools.push(t.toolDefinition));
    }
    return allTools;
  }, [version]);

  const availableTools = useMemo(() => {
    if (!currentAssistant?.localServices) {
      return [];
    }

    const enabledTools: Tool[] = [];
    for (const serviceName of currentAssistant.localServices) {
      const service = getService(serviceName);
      if (service) {
        for (const tool of service.tools) {
          enabledTools.push({ ...tool.toolDefinition, isLocal: true });
        }
      }
    }
    return enabledTools;
  }, [currentAssistant, getService, version]);

  const availableToolsRef = useRef(availableTools);

  useEffect(() => {
    availableToolsRef.current = availableTools;
  }, [availableTools]);

  const getAvailableTools = useCallback(() => {
    return availableToolsRef.current;
  }, []);

  const isLocalTool = useCallback(
    (toolName: string) => {
      return allRegisteredTools.some((tool) => tool.name === toolName);
    },
    [allRegisteredTools],
  );

  const value = useMemo(
    () => ({
      registerService,
      unregisterService,
      availableTools,
      getToolsByService,
      getAvailableServices,
      getAvailableTools,
      getService,
      getToolByName,
      executeToolCall: scheduledExecuteToolCall,
      isLocalTool,
    }),
    [
      registerService,
      unregisterService,
      availableTools,
      getAvailableTools,
      getToolsByService,
      getAvailableServices,
      getService,
      getToolByName,
      scheduledExecuteToolCall,
      isLocalTool,
    ],
  );

  return (
    <LocalToolContext.Provider value={value}>
      {children}
    </LocalToolContext.Provider>
  );
}

export const useLocalTools = () => {
  const context = useContext(LocalToolContext);
  if (!context) {
    throw new Error('useLocalTools must be used within a LocalToolProvider');
  }
  return context;
};
