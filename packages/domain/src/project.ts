import type { CanonicalCommand, ContinuationOffer, ProjectAggregate, ProjectTaskNode, TaskDefinition } from "../../schemas/src/index.js";
import type { EventDraft } from "../../events/src/index.js";
import { reject } from "./errors.js";

type Payload = Record<string, unknown>;

function payload(command: CanonicalCommand): Payload {
  return command.payload as Payload;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) reject("INVALID_COMMAND", `${field} is required`, { field });
  return value;
}

function requireArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) reject("INVALID_COMMAND", `${field} must be an array`, { field });
  return value as T[];
}

export function taskStreamIdFor(taskId: string): string {
  return `task:${taskId}`;
}

export function emptyProjectAggregate(streamId: string): ProjectAggregate {
  return { aggregateType: "project", streamId, version: 0, project: null, taskGraph: {}, completedTaskIds: [] };
}

function validateDefinition(definition: TaskDefinition): void {
  requireText(definition.taskId, "task.taskId");
  requireText(definition.title, "task.title");
  requireText(definition.description, "task.description");
  requireText(definition.proofRequirement, "task.proofRequirement");
  if (!Array.isArray(definition.dependencyIds) || new Set(definition.dependencyIds).size !== definition.dependencyIds.length) reject("INVALID_COMMAND", "Task dependencies must be a unique array", { taskId: definition.taskId });
  if (definition.dependencyIds.includes(definition.taskId)) reject("INVALID_COMMAND", "A task cannot depend on itself", { taskId: definition.taskId });
}

function assertAcyclic(graph: Record<string, ProjectTaskNode>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): void => {
    if (visiting.has(taskId)) reject("INVALID_COMMAND", "Task graph contains a cycle", { taskId });
    if (visited.has(taskId)) return;
    const node = graph[taskId];
    if (!node) reject("INVALID_COMMAND", "Task dependency does not exist", { taskId });
    visiting.add(taskId);
    for (const dependencyId of node.dependencyIds) {
      if (!graph[dependencyId]) reject("INVALID_COMMAND", "Task dependency does not exist", { taskId, dependencyId });
      visit(dependencyId);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };
  Object.keys(graph).forEach(visit);
}

function nodesForInitialDefinitions(definitions: TaskDefinition[], ordinalStart = 0): Record<string, ProjectTaskNode> {
  if (definitions.length === 0) reject("INVALID_COMMAND", "A project chapter needs at least one task");
  const seen = new Set<string>();
  const graph: Record<string, ProjectTaskNode> = {};
  definitions.forEach((definition, index) => {
    validateDefinition(definition);
    if (seen.has(definition.taskId)) reject("CONFLICT", "Task ID is duplicated", { taskId: definition.taskId });
    for (const dependencyId of definition.dependencyIds) {
      if (!seen.has(dependencyId)) reject("INVALID_COMMAND", "Initial dependencies must resolve backward within the chapter", { taskId: definition.taskId, dependencyId });
    }
    seen.add(definition.taskId);
    graph[definition.taskId] = { taskId: definition.taskId, taskStreamId: taskStreamIdFor(definition.taskId), dependencyIds: [...definition.dependencyIds], ordinal: ordinalStart + index };
  });
  if (!definitions.some(({ dependencyIds }) => dependencyIds.length === 0)) reject("INVALID_COMMAND", "A chapter needs a traversable root task");
  return graph;
}

export function decideProjectCommand(state: ProjectAggregate, command: CanonicalCommand): EventDraft<unknown>[] {
  const input = payload(command);
  switch (command.type) {
    case "CreateProject": {
      if (state.project) reject("CONFLICT", "Project stream is already initialized");
      const projectId = requireText(input.projectId, "projectId");
      const definitions = requireArray<TaskDefinition>(input.tasks, "tasks");
      const graph = nodesForInitialDefinitions(definitions);
      return [
        { type: "ProjectCreated", payload: { project: { projectId, title: requireText(input.title, "title"), description: requireText(input.description, "description"), status: "active", chapter: 1, taskOrder: definitions.map(({ taskId }) => taskId), continuationOffers: [] } } },
        ...definitions.map((definition) => ({ type: "TaskAdded" as const, payload: { task: definition, node: graph[definition.taskId] } })),
      ];
    }
    case "EditProject":
      if (!state.project) reject("NOT_FOUND", "Project does not exist");
      if (state.project.status === "completed") reject("SEALED_HISTORY", "A completed project cannot be edited");
      return [{ type: "ProjectEdited", payload: { projectId: state.project.projectId, title: requireText(input.title, "title"), description: requireText(input.description, "description") } }];
    case "AddTask": {
      if (!state.project) reject("NOT_FOUND", "Project does not exist");
      if (state.project.status === "completed") reject("SEALED_HISTORY", "Use ContinueProject after project completion");
      const definition = input.task as TaskDefinition;
      validateDefinition(definition);
      if (state.taskGraph[definition.taskId]) reject("CONFLICT", "Task already exists", { taskId: definition.taskId });
      const node: ProjectTaskNode = { taskId: definition.taskId, taskStreamId: taskStreamIdFor(definition.taskId), dependencyIds: [...definition.dependencyIds], ordinal: Object.keys(state.taskGraph).length };
      const candidate = { ...state.taskGraph, [node.taskId]: node };
      assertAcyclic(candidate);
      return [{ type: "TaskAdded", payload: { task: definition, node } }];
    }
    case "SetTaskDependencies": {
      if (!state.project) reject("NOT_FOUND", "Project does not exist");
      const taskId = requireText(input.taskId, "taskId");
      if (!state.taskGraph[taskId]) reject("NOT_FOUND", "Task graph node does not exist", { taskId });
      if (state.completedTaskIds.includes(taskId)) reject("SEALED_HISTORY", "Completed task topology cannot be rewritten", { taskId });
      const dependencyIds = requireArray<string>(input.dependencyIds, "dependencyIds");
      if (new Set(dependencyIds).size !== dependencyIds.length || dependencyIds.includes(taskId)) reject("INVALID_COMMAND", "Dependencies must be unique and cannot include the task itself");
      const candidate = structuredClone(state.taskGraph);
      candidate[taskId]!.dependencyIds = [...dependencyIds];
      assertAcyclic(candidate);
      return [{ type: "TaskDependenciesSet", payload: { taskId, dependencyIds } }];
    }
    case "ContinueProject": {
      if (!state.project) reject("NOT_FOUND", "Project does not exist");
      if (state.project.status !== "completed") reject("INVALID_TRANSITION", "Only a completed project can continue");
      const continuationId = requireText(input.continuationId, "continuationId");
      if (!state.project.continuationOffers.some((offer) => offer.continuationId === continuationId)) reject("NOT_FOUND", "Continuation was not offered", { continuationId });
      const definitions = requireArray<TaskDefinition>(input.tasks, "tasks");
      const chapterGraph = nodesForInitialDefinitions(definitions, Object.keys(state.taskGraph).length);
      for (const taskId of Object.keys(chapterGraph)) if (state.taskGraph[taskId]) reject("CONFLICT", "Continuation task ID already exists", { taskId });
      return [
        { type: "ProjectContinued", payload: { projectId: state.project.projectId, continuationId, chapter: state.project.chapter + 1, taskIds: definitions.map(({ taskId }) => taskId) } },
        ...definitions.map((definition) => ({ type: "TaskAdded" as const, payload: { task: definition, node: chapterGraph[definition.taskId] } })),
      ];
    }
    default:
      reject("INVALID_COMMAND", `${command.type} is not a project command`);
  }
}

export function evolveProject(state: ProjectAggregate, event: { type: string; streamVersion: number; payload: unknown }): ProjectAggregate {
  const next = structuredClone(state);
  const input = event.payload as Payload;
  switch (event.type) {
    case "ProjectCreated":
      next.project = input.project as ProjectAggregate["project"];
      break;
    case "ProjectEdited":
      Object.assign(next.project!, { title: input.title, description: input.description });
      break;
    case "ProjectCompleted":
      next.project!.status = "completed";
      break;
    case "ProjectContinued":
      next.project!.status = "active";
      next.project!.chapter = input.chapter as number;
      next.project!.continuationOffers = [];
      next.project!.taskOrder.push(...(input.taskIds as string[]));
      break;
    case "TaskAdded": {
      const node = input.node as ProjectTaskNode;
      next.taskGraph[node.taskId] = node;
      if (next.project && !next.project.taskOrder.includes(node.taskId)) next.project.taskOrder.push(node.taskId);
      break;
    }
    case "TaskDependenciesSet":
      next.taskGraph[input.taskId as string]!.dependencyIds = [...(input.dependencyIds as string[])];
      break;
    case "ProjectTaskCompleted":
      if (!next.completedTaskIds.includes(input.taskId as string)) next.completedTaskIds.push(input.taskId as string);
      break;
    case "ContinuationOffered":
      next.project!.continuationOffers = structuredClone(input.options as ContinuationOffer[]);
      break;
  }
  next.version = event.streamVersion;
  return next;
}

export function deriveProjectProgress(state: ProjectAggregate): number {
  const count = Object.keys(state.taskGraph).length;
  return count === 0 ? 0 : Math.round((state.completedTaskIds.length / count) * 100);
}

export function graphDependents(state: ProjectAggregate, completedTaskId: string): ProjectTaskNode[] {
  const completed = new Set([...state.completedTaskIds, completedTaskId]);
  return Object.values(state.taskGraph).filter((node) => !completed.has(node.taskId) && node.dependencyIds.includes(completedTaskId) && node.dependencyIds.every((dependencyId) => completed.has(dependencyId)));
}

export function projectWouldComplete(state: ProjectAggregate, completedTaskId: string): boolean {
  return Object.keys(state.taskGraph).every((taskId) => taskId === completedTaskId || state.completedTaskIds.includes(taskId));
}
