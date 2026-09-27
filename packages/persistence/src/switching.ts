import { dataRootGenerationSchema, type DataRootGeneration } from "@call-nina/contracts";

import { writeBootstrapPointer } from "./bootstrap-pointer.js";
import { materializeDataRootSelection, type DataRootSelectionPlan } from "./data-root-selection.js";
import { callNinaMigrations } from "./migrations.js";
import { prepareDataRootDatabase, type CallNinaDatabase } from "./sqlite.js";

export async function switchCallNinaDataRoot(options: {
  currentDatabase: CallNinaDatabase;
  bootstrapFile: string;
  nextSelection: DataRootSelectionPlan;
  expectedGeneration: DataRootGeneration;
  selectedAt: string;
  createdAt: string;
}): Promise<CallNinaDatabase> {
  if (options.currentDatabase.rootGeneration !== options.expectedGeneration) {
    throw new Error("OD_DATA_ROOT_SWITCH_GENERATION_CONFLICT");
  }
  const nextGeneration = dataRootGenerationSchema.parse(options.expectedGeneration + 1);
  const materializeOptions = {
    generation: nextGeneration,
    createdAt: options.createdAt,
  };
  const materialized = await materializeDataRootSelection(
    options.nextSelection,
    materializeOptions,
  );

  const preparedDatabase = await prepareDataRootDatabase({
    bootstrapFile: options.bootstrapFile,
    dataRoot: materialized.dataRoot,
    rootGeneration: nextGeneration,
    migrations: callNinaMigrations,
  });
  try {
    await writeBootstrapPointer({
      bootstrapFile: options.bootstrapFile,
      dataRoot: materialized.dataRoot,
      expectedGeneration: options.expectedGeneration,
      selectedAt: options.selectedAt,
    });
  } catch (error) {
    preparedDatabase.close();
    throw error;
  }
  options.currentDatabase.close();
  return preparedDatabase;
}

export async function initializeCallNinaDataRoot(options: {
  bootstrapFile: string;
  selection: DataRootSelectionPlan;
  selectedAt: string;
  createdAt: string;
}): Promise<CallNinaDatabase> {
  const generation = dataRootGenerationSchema.parse(1);
  const materialized = await materializeDataRootSelection(options.selection, {
    generation,
    createdAt: options.createdAt,
  });
  const preparedDatabase = await prepareDataRootDatabase({
    bootstrapFile: options.bootstrapFile,
    dataRoot: materialized.dataRoot,
    rootGeneration: generation,
    migrations: callNinaMigrations,
  });
  try {
    await writeBootstrapPointer({
      bootstrapFile: options.bootstrapFile,
      dataRoot: materialized.dataRoot,
      expectedGeneration: null,
      selectedAt: options.selectedAt,
    });
  } catch (error) {
    preparedDatabase.close();
    throw error;
  }
  return preparedDatabase;
}

export async function recoverCallNinaDataRoot(options: {
  bootstrapFile: string;
  nextSelection: DataRootSelectionPlan;
  expectedGeneration: DataRootGeneration;
  selectedAt: string;
  createdAt: string;
}): Promise<CallNinaDatabase> {
  const nextGeneration = dataRootGenerationSchema.parse(options.expectedGeneration + 1);
  const materialized = await materializeDataRootSelection(options.nextSelection, {
    generation: nextGeneration,
    createdAt: options.createdAt,
  });
  const preparedDatabase = await prepareDataRootDatabase({
    bootstrapFile: options.bootstrapFile,
    dataRoot: materialized.dataRoot,
    rootGeneration: nextGeneration,
    migrations: callNinaMigrations,
  });
  try {
    await writeBootstrapPointer({
      bootstrapFile: options.bootstrapFile,
      dataRoot: materialized.dataRoot,
      expectedGeneration: options.expectedGeneration,
      selectedAt: options.selectedAt,
    });
  } catch (error) {
    preparedDatabase.close();
    throw error;
  }
  return preparedDatabase;
}
