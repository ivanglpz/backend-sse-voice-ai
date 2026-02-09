export const SERVER_PORT = 3000;
export const MAX_HTTP_BUFFER_SIZE = 10_000_000;

export const DEFAULT_SAMPLE_RATE = 16000;
export const DEFAULT_CHANNELS = 1;
export const DEFAULT_ENCODING = "pcm_s16le";

export const INITIAL_NOISE_DB = -55;
export const SPEECH_MARGIN_DB = 10;
export const SILENCE_MS_TO_FINALIZE = 800;
export const MIN_SPEECH_DB = -42;
export const START_SPEECH_MIN_MS = 120;
export const NOISE_UPDATE_ALPHA = 0.03;
export const NOISE_UPDATE_GATE_DB = 3;
export const LEVEL_SMOOTHING_ALPHA = 0.2;
export const MIN_SEGMENT_MS = 250;
