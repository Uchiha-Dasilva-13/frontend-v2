<script setup lang="ts">
/**
 * A series of actions the user must perform, displayed horizontally as a series of dots
 * As each action is in progress or completed the dot changes to reflect its
 * current state.
 *
 * Useful if there are an arbitrary number of actions the user must take such as
 * "approve n tokens, then add liquidity to a pool.""
 */
import { ChainId } from '@aave/protocol-js';
import {
  TransactionReceipt,
  TransactionResponse,
} from '@ethersproject/abstract-provider';

import AnimatePresence from '@/components/animate/AnimatePresence.vue';
import useEthers from '@/composables/useEthers';
import { dateTimeLabelFor } from '@/composables/useTime';
import useTransactionErrors from '@/composables/useTransactionErrors';
import { configService } from '@/services/config/config.service';
import { Step, StepState } from '@/types';
import {
  TransactionAction,
  TransactionActionInfo,
  TransactionActionState,
} from '@/types/transactions';
import signature from '@/assets/images/icons/signature.svg';
import { captureException } from '@sentry/core';
import { useI18n } from 'vue-i18n';

/**
 * TYPES
 */
type Props = {
  actions: TransactionActionInfo[];
  disabled?: boolean;
  // override action state loading prop and show
  // loading for all steps
  isLoading?: boolean;
  // override action state loading label
  // for all steps
  loadingLabel?: string;
};

/**
 * PROPS & EMITS
 */
const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  isLoading: false,
  loadingLabel: '',
});

const emit = defineEmits<{
  (e: 'success', value: any): void;
  (e: 'setCurrentActionIndex', value: number): void;
}>();

const defaultActionState: TransactionActionState = {
  init: false,
  confirming: false,
  confirmed: false,
  confirmedAt: '',
};

/**
 * STATE
 */
const currentActionIndex = ref(0);
const _actions = ref<TransactionActionInfo[]>(props.actions);
const actionStates = ref<TransactionActionState[]>([]);

/**
 * LIFECYCLE
 */
onBeforeMount(() => {
  actionStates.value = props.actions.map(() => ({
    ...defaultActionState,
  }));
});

/**
 * WATCHERS
 */
watch(
  () => props.actions,
  newActions => {
    newActions.forEach((action, i) => {
      _actions.value[i] = action;
      if (!actionStates.value[i]) {
        actionStates.value[i] = {
          ...defaultActionState,
        };
      }
    });
  },
  { deep: true }
);

watch(
  () => currentActionIndex.value,
  (val: number) => {
    emit('setCurrentActionIndex', val);
  },
  { immediate: true }
);
/**
 * COMPOSABLES
 */
const { txListener, getTxConfirmedAt } = useEthers();
const { parseError } = useTransactionErrors();
const { t } = useI18n();

/**
 * COMPUTED
 */

const actions = computed((): TransactionAction[] => {
  return _actions.value.map((actionInfo, idx) => {
    const actionState = actionStates.value[idx];
    return {
      label: actionInfo.label,
      loadingLabel: actionState.init
        ? actionInfo.loadingLabel
        : actionInfo.confirmingLabel,
      pending: actionState.init || actionState.confirming,
      isSignAction: actionInfo.isSignAction,
      promise: submit.bind(null, actionInfo, actionState),
      step: {
        tooltip: actionInfo.stepTooltip,
        state: getStepState(actionState, idx),
      },
    };
  });
});

const currentAction = computed(
  (): TransactionAction | undefined => actions.value[currentActionIndex.value]
);

const currentActionState = computed(
  (): TransactionActionState => actionStates.value[currentActionIndex.value]
);

const lastActionState = computed(
  (): TransactionActionState =>
    actionStates.value[actionStates.value.length - 1]
);

const steps = computed((): Step[] => actions.value.map(action => action.step));

const spacerWidth = computed((): number => {
  return 13 - steps.value.length;
});

const _loadingLabel = computed((): string => {
  if (currentAction.value?.pending) return currentAction.value.loadingLabel;
  return props.loadingLabel || t('Loading');
});

/**
 * METHODS
 */

function getStepState(
  actionState: TransactionActionState,
  index: number
): StepState {
  if (currentActionIndex.value < index) return StepState.Todo;
  else if (actionState.confirming) return StepState.Pending;
  else if (actionState.init) return StepState.WalletOpen;
  else if (actionState.confirmed) return StepState.Success;
  return StepState.Active;
}

async function submit(
  actionInfo: TransactionActionInfo,
  state: TransactionActionState
): Promise<void> {
  const { action } = actionInfo;
  try {
    state.init = true;
    state.error = null;

    const tx = await action();

    state.init = false;
    state.confirming = true;

    if (currentAction.value?.isSignAction) {
      handleSignAction(state);
      return;
    }

    if (tx) handleTransaction(tx, state, actionInfo);
  } catch (error) {
    state.init = false;
    state.confirming = false;
    state.error = parseError(error);
    if (state.error) {
      console.error(error);
      captureException(error);
    }
  }
}

function handleSignAction(state: TransactionActionState) {
  currentActionIndex.value += 1;
  state.confirming = false;
  state.confirmed = true;
}

async function handleTransaction(
  tx: TransactionResponse,
  state: TransactionActionState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  actionInfo: TransactionActionInfo
): Promise<void> {
  // const { postActionValidation, actionInvalidReason } = actionInfo;

  await txListener(tx, {
    onTxConfirmed: async (receipt: TransactionReceipt) => {
      state.receipt = receipt;

      // need to explicity wait for a number of confirmations
      // on polygon
      if (Number(configService.network.chainId) === ChainId.polygon) {
        await tx.wait(10);
      }

      state.confirming = false;

      // const isValid = await postActionValidation?.();
      // if (isValid || !postActionValidation) {
      const confirmedAt = await getTxConfirmedAt(receipt);
      state.confirmedAt = dateTimeLabelFor(confirmedAt);
      state.confirmed = true;
      if (currentActionIndex.value >= actions.value.length - 1) {
        emit('success', { receipt, confirmedAt: state.confirmedAt });
      } else {
        currentActionIndex.value += 1;
      }
      // } else {
      //   // post action validation failed, display reason.
      //   if (actionInvalidReason) state.error = actionInvalidReason;
      //   state.init = false;
      // }
    },
    onTxFailed: () => {
      state.confirming = false;
    },
  });
}
</script>

<template>
  <div>
    <AnimatePresence isVisible>
      <BalAlert
        v-if="currentActionState?.error && !isLoading"
        type="error"
        :title="currentActionState?.error?.title"
        :description="currentActionState?.error?.description"
        block
        class="mb-4"
      />
      <BalStack vertical>
        <BalHorizSteps
          v-if="actions.length > 1 && !lastActionState?.confirmed"
          :steps="steps"
          :spacerWidth="spacerWidth"
          class="flex justify-center"
        />
        <BalBtn
          v-if="!lastActionState?.confirmed"
          :disabled="props.disabled"
          color="gradient"
          :loading="currentAction?.pending || isLoading"
          :loadingLabel="_loadingLabel"
          block
          @click="currentAction?.promise()"
        >
          <div
            :class="{
              'flex grow justify-between items-center':
                currentAction?.isSignAction,
            }"
          >
            <img v-if="currentAction?.isSignAction" :src="signature" />
            {{ currentAction?.label }}
            <div v-if="currentAction?.isSignAction" class="w-8"></div>
          </div>
        </BalBtn>
      </BalStack>
    </AnimatePresence>
  </div>
</template>
