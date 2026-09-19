"""OpenTelemetry setup. Spans carry only metadata (task, model, tokens,
latency) — never prompts or images (SPEC §12). Exports to the self-hosted
collector when OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise a no-op."""

from contextlib import contextmanager

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from ..config import get_settings

_ready = False


def setup() -> None:
    global _ready
    if _ready:
        return
    s = get_settings()
    provider = TracerProvider(resource=Resource.create({"service.name": s.otel_service_name}))
    if s.otel_exporter_otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=s.otel_exporter_otlp_endpoint.rstrip("/") + "/v1/traces")))
    trace.set_tracer_provider(provider)
    _ready = True


@contextmanager
def span(name: str, **attrs):
    setup()
    tracer = trace.get_tracer("sop-tutor")
    with tracer.start_as_current_span(name) as sp:
        for k, v in attrs.items():
            if v is not None:
                sp.set_attribute(k, v)
        yield sp
