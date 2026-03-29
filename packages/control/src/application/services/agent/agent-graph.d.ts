/**
 * LangGraph Graph Construction and State Management
 *
 * Defines the agent state, builds the StateGraph with agent/tool nodes,
 * and exports the createLangGraphAgent factory.
 */
import { BaseMessage, ToolMessage } from '@langchain/core/messages';
import { type CreateAgentOptions } from './graph-tools';
export declare const AgentState: import("@langchain/langgraph/web").AnnotationRoot<{
    messages: import("@langchain/langgraph/web").BinaryOperatorAggregate<BaseMessage<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>, import("@langchain/core/messages").MessageType>[], BaseMessage<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>, import("@langchain/core/messages").MessageType>[]>;
    iteration: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
    maxIterations: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
    consecutiveErrors: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
    lastToolResultHash: import("@langchain/langgraph/web").BinaryOperatorAggregate<string, string>;
    consecutiveSameResults: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
}>;
export type AgentStateType = typeof AgentState.State;
export declare function createLangGraphAgent(options: CreateAgentOptions): {
    graph: import("@langchain/langgraph/web").CompiledStateGraph<{
        messages: BaseMessage<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>, import("@langchain/core/messages").MessageType>[];
        iteration: number;
        maxIterations: number;
        consecutiveErrors: number;
        lastToolResultHash: string;
        consecutiveSameResults: number;
    }, {
        messages?: BaseMessage<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>, import("@langchain/core/messages").MessageType>[] | undefined;
        iteration?: number | undefined;
        maxIterations?: number | undefined;
        consecutiveErrors?: number | undefined;
        lastToolResultHash?: string | undefined;
        consecutiveSameResults?: number | undefined;
    }, "agent" | "tools" | "__start__", {
        messages: import("@langchain/langgraph/web").BinaryOperatorAggregate<BaseMessage<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>, import("@langchain/core/messages").MessageType>[], BaseMessage<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>, import("@langchain/core/messages").MessageType>[]>;
        iteration: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
        maxIterations: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
        consecutiveErrors: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
        lastToolResultHash: import("@langchain/langgraph/web").BinaryOperatorAggregate<string, string>;
        consecutiveSameResults: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
    }, {
        messages: import("@langchain/langgraph/web").BinaryOperatorAggregate<BaseMessage<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>, import("@langchain/core/messages").MessageType>[], BaseMessage<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>, import("@langchain/core/messages").MessageType>[]>;
        iteration: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
        maxIterations: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
        consecutiveErrors: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
        lastToolResultHash: import("@langchain/langgraph/web").BinaryOperatorAggregate<string, string>;
        consecutiveSameResults: import("@langchain/langgraph/web").BinaryOperatorAggregate<number, number>;
    }, import("@langchain/langgraph/web").StateDefinition, {
        agent: {
            messages: import("@langchain/core/messages").AIMessageChunk<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>>[];
            iteration: number;
        };
        tools: {
            messages: never[];
            consecutiveErrors: number;
            consecutiveSameResults: number;
            lastToolResultHash?: undefined;
        } | {
            messages: ToolMessage<import("@langchain/core/messages").MessageStructure<import("@langchain/core/messages").MessageToolSet>>[];
            consecutiveErrors: number;
            lastToolResultHash: string;
            consecutiveSameResults: number;
        };
    }, unknown, unknown>;
    systemPrompt: string;
    maxIterations: number;
};
//# sourceMappingURL=agent-graph.d.ts.map