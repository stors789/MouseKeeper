import type {
  Cage,
  Experiment,
  Mouse,
  MouseEvent,
  WeightRecord
} from '../domain/types'
import { createCsv } from './csv'

export interface MouseExportRecord {
  mouse: Mouse
  cageNumber?: string
  tagNames?: readonly string[]
}

export interface CageExportRecord {
  cage: Cage
  currentCount: number
}

export interface ExperimentExportRecord {
  experiment: Experiment
  groupCount: number
  activeMouseCount: number
}

export interface WeightExportRecord {
  weight: WeightRecord
  mouseLabel: string
}

export interface EventExportRecord {
  event: MouseEvent
  mouseLabel: string
  cageNumber?: string
  experimentName?: string
}

export function exportMiceCsv(records: readonly MouseExportRecord[]): string {
  return createCsv(records, [
    { key: 'id', header: 'id', value: ({ mouse }) => mouse.id },
    { key: 'earTag', header: 'earTag', value: ({ mouse }) => mouse.earTag },
    {
      key: 'experimentNumber',
      header: 'experimentNumber',
      value: ({ mouse }) => mouse.experimentNumber
    },
    { key: 'name', header: 'name', value: ({ mouse }) => mouse.name },
    { key: 'alias', header: 'alias', value: ({ mouse }) => mouse.alias },
    { key: 'strain', header: 'strain', value: ({ mouse }) => mouse.strain },
    {
      key: 'genotype',
      header: 'genotype',
      value: ({ mouse }) => mouse.genotype
    },
    { key: 'sex', header: 'sex', value: ({ mouse }) => mouse.sex },
    {
      key: 'birthDate',
      header: 'birthDate',
      value: ({ mouse }) => mouse.birthDate
    },
    {
      key: 'cageNumber',
      header: 'cageNumber',
      value: ({ cageNumber }) => cageNumber
    },
    { key: 'status', header: 'status', value: ({ mouse }) => mouse.status },
    { key: 'source', header: 'source', value: ({ mouse }) => mouse.source },
    {
      key: 'coatColor',
      header: 'coatColor',
      value: ({ mouse }) => mouse.coatColor
    },
    {
      key: 'tags',
      header: 'tags',
      value: ({ tagNames }) => tagNames?.join(';')
    },
    { key: 'notes', header: 'notes', value: ({ mouse }) => mouse.notes },
    {
      key: 'createdAt',
      header: 'createdAt',
      value: ({ mouse }) => mouse.createdAt
    },
    {
      key: 'updatedAt',
      header: 'updatedAt',
      value: ({ mouse }) => mouse.updatedAt
    },
    {
      key: 'deletedAt',
      header: 'deletedAt',
      value: ({ mouse }) => mouse.deletedAt
    },
    { key: 'origin', header: 'origin', value: ({ mouse }) => mouse.origin }
  ])
}

export function exportCagesCsv(records: readonly CageExportRecord[]): string {
  return createCsv(records, [
    { key: 'id', header: 'id', value: ({ cage }) => cage.id },
    {
      key: 'cageNumber',
      header: 'cageNumber',
      value: ({ cage }) => cage.cageNumber
    },
    { key: 'room', header: 'room', value: ({ cage }) => cage.room },
    { key: 'rack', header: 'rack', value: ({ cage }) => cage.rack },
    {
      key: 'maxCapacity',
      header: 'maxCapacity',
      value: ({ cage }) => cage.maxCapacity
    },
    {
      key: 'currentCount',
      header: 'currentCount',
      value: ({ currentCount }) => currentCount
    },
    {
      key: 'primaryStrain',
      header: 'primaryStrain',
      value: ({ cage }) => cage.primaryStrain
    },
    { key: 'purpose', header: 'purpose', value: ({ cage }) => cage.purpose },
    { key: 'status', header: 'status', value: ({ cage }) => cage.status },
    { key: 'notes', header: 'notes', value: ({ cage }) => cage.notes },
    {
      key: 'createdAt',
      header: 'createdAt',
      value: ({ cage }) => cage.createdAt
    },
    {
      key: 'updatedAt',
      header: 'updatedAt',
      value: ({ cage }) => cage.updatedAt
    },
    {
      key: 'deletedAt',
      header: 'deletedAt',
      value: ({ cage }) => cage.deletedAt
    }
  ])
}

export function exportExperimentsCsv(
  records: readonly ExperimentExportRecord[]
): string {
  return createCsv(records, [
    { key: 'id', header: 'id', value: ({ experiment }) => experiment.id },
    { key: 'code', header: 'code', value: ({ experiment }) => experiment.code },
    { key: 'name', header: 'name', value: ({ experiment }) => experiment.name },
    {
      key: 'description',
      header: 'description',
      value: ({ experiment }) => experiment.description
    },
    {
      key: 'startDate',
      header: 'startDate',
      value: ({ experiment }) => experiment.startDate
    },
    {
      key: 'endDate',
      header: 'endDate',
      value: ({ experiment }) => experiment.endDate
    },
    {
      key: 'status',
      header: 'status',
      value: ({ experiment }) => experiment.status
    },
    {
      key: 'groupCount',
      header: 'groupCount',
      value: ({ groupCount }) => groupCount
    },
    {
      key: 'activeMouseCount',
      header: 'activeMouseCount',
      value: ({ activeMouseCount }) => activeMouseCount
    },
    {
      key: 'intervention',
      header: 'intervention',
      value: ({ experiment }) => experiment.intervention
    },
    {
      key: 'dose',
      header: 'dose',
      value: ({ experiment }) => experiment.dose
    },
    {
      key: 'frequency',
      header: 'frequency',
      value: ({ experiment }) => experiment.frequency
    },
    {
      key: 'principalInvestigator',
      header: 'principalInvestigator',
      value: ({ experiment }) => experiment.principalInvestigator
    },
    {
      key: 'notes',
      header: 'notes',
      value: ({ experiment }) => experiment.notes
    }
  ])
}

export function exportWeightsCsv(records: readonly WeightExportRecord[]): string {
  return createCsv(records, [
    { key: 'id', header: 'id', value: ({ weight }) => weight.id },
    {
      key: 'mouseId',
      header: 'mouseId',
      value: ({ weight }) => weight.mouseId
    },
    {
      key: 'mouseLabel',
      header: 'mouseLabel',
      value: ({ mouseLabel }) => mouseLabel
    },
    {
      key: 'measuredOn',
      header: 'measuredOn',
      value: ({ weight }) => weight.measuredOn
    },
    {
      key: 'measuredTime',
      header: 'measuredTime',
      value: ({ weight }) => weight.measuredTime
    },
    { key: 'value', header: 'value', value: ({ weight }) => weight.value },
    { key: 'unit', header: 'unit', value: ({ weight }) => weight.unit },
    {
      key: 'valueGrams',
      header: 'valueGrams',
      value: ({ weight }) => weight.valueGrams
    },
    { key: 'notes', header: 'notes', value: ({ weight }) => weight.notes },
    {
      key: 'createdAt',
      header: 'createdAt',
      value: ({ weight }) => weight.createdAt
    }
  ])
}

export function exportEventsCsv(records: readonly EventExportRecord[]): string {
  return createCsv(records, [
    { key: 'id', header: 'id', value: ({ event }) => event.id },
    {
      key: 'eventType',
      header: 'eventType',
      value: ({ event }) => event.eventType
    },
    {
      key: 'occurredOn',
      header: 'occurredOn',
      value: ({ event }) => event.occurredOn
    },
    {
      key: 'occurredTime',
      header: 'occurredTime',
      value: ({ event }) => event.occurredTime
    },
    {
      key: 'mouseId',
      header: 'mouseId',
      value: ({ event }) => event.mouseId
    },
    {
      key: 'mouseLabel',
      header: 'mouseLabel',
      value: ({ mouseLabel }) => mouseLabel
    },
    {
      key: 'cageNumber',
      header: 'cageNumber',
      value: ({ cageNumber }) => cageNumber
    },
    {
      key: 'experimentName',
      header: 'experimentName',
      value: ({ experimentName }) => experimentName
    },
    { key: 'title', header: 'title', value: ({ event }) => event.title },
    {
      key: 'description',
      header: 'description',
      value: ({ event }) => event.description
    },
    {
      key: 'createdAt',
      header: 'createdAt',
      value: ({ event }) => event.createdAt
    }
  ])
}
