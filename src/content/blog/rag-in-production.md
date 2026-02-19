---
title: "Building Production RAG Systems: Lessons from Three Deployments"
description: "What actually breaks when you move retrieval-augmented generation from a demo to something that handles real users and real documents — from the World Bank to enterprise contracts."
date: 2025-11-10
tags: ["ML", "RAG", "infrastructure", "LLMs"]
draft: false
---

I've now built RAG systems in three meaningfully different contexts: a research platform at a university lab, a large-scale document analysis pipeline for the World Bank, and a production chatbot for an enterprise software company. Each one taught me something the previous hadn't.

This isn't a "here's how RAG works" post — there are plenty of those. This is about what breaks at the seams between the clean demo and the thing people actually use.

## Chunking is the first thing you get wrong

The naive approach — split documents into fixed-size chunks of N tokens — works well enough to get a prototype running. It stops working the moment your documents have any structure that matters.

PDFs with tables, documents where a bullet point refers to context established three sections ago, contracts where the defined terms section is critical for understanding every clause that follows: fixed-size chunking destroys all of this.

At GeoLab, we were processing complex research documents with embedded figures, tables, and cross-references. I switched to using a Vision-Language Model (Qwen-2.5-VL) for document parsing rather than naive PDF text extraction. The difference in chunk quality — and downstream retrieval precision — was substantial. Parsing errors dropped by over 50% compared to tools like PyMuPDF or pdfplumber for complex layouts.

The lesson: **your chunking strategy should be informed by your document structure, not just your context window size.**

## Evaluation has to come before you optimize

At Teamculture.ai, I built an evaluation system before we had a production chatbot. That sounds backwards, but it was the right call. Without a fixed evaluation suite — golden examples with expected answers, RAGAS metrics, threshold targets — every change to the system is a guess.

The system ran on AWS Lambda + API Gateway, which meant evaluation could be triggered on every significant change without blocking the main development loop. We curated golden datasets from real user queries, which meant the evaluation suite got more realistic over time rather than drifting from actual usage.

The specific metrics that mattered for our use case:
- **Context recall** — was the right document even being retrieved?
- **Faithfulness** — was the generated answer grounded in the retrieved context, or was the model confabulating?
- **Answer relevance** — was the answer actually responsive to the question?

RAGAS gives you all three. Getting to 70–80% across these metrics on a domain-specific corpus is non-trivial — and knowing your baseline means you can tell whether a change to your prompts, retrieval parameters, or chunking strategy actually helped.

## The vector database is not the bottleneck you think it is

Qdrant is fast. At the scale of tens of thousands of documents (the World Bank project analyzed 24,000+ GEF project documents), properly indexed vector search is not your bottleneck. Your bottleneck is almost always one of:

1. The embedding step for new documents at ingestion time
2. The LLM inference step at query time
3. Your document pre-processing pipeline

For the World Bank project, the embedding step was the wall. We were running on CPU initially, which made ingestion of 24,000 documents slow enough to matter. Switching to a GPU instance for the batch ingestion job reduced that dramatically.

At Luminexis, the LLM inference step was the constraint — we were using Azure OpenAI, which has rate limits that become relevant when you're processing 140+ contract documents and need to stay within API quotas. The fix was a combination of batching, caching embeddings aggressively, and structuring the pipeline to process in waves rather than a continuous stream.

## Production means someone else's data

The biggest difference between a demo and a production system isn't technical — it's that production means handling data that matters to someone. Contracts, grant documents, proprietary research: all of these carry stakes that a demo never has.

This shapes a few things:

- **Where embeddings are computed matters.** Sending sensitive documents to a third-party embedding API may not be acceptable. Know your data residency requirements before you choose your stack.
- **Chunking personally identifiable information** requires care about what ends up stored in your vector database and accessible via retrieval.
- **Logging retrieved context** for debugging is useful during development and a liability concern in production.

The right answer to most of these depends on your specific situation. But they're questions you should answer before you get to production, not after.

## What I'd do differently

If I were starting a new RAG system today, I'd:

1. **Start with evaluation infrastructure.** Even a small golden dataset and a few RAGAS metrics will tell you more than a demo will.
2. **Invest in document parsing early.** The quality of your parsed text is the ceiling on everything downstream.
3. **Pick a vector database with filtering.** Qdrant's payload filtering is excellent — being able to filter by metadata (document type, date, source) before or after semantic search dramatically improves retrieval precision for structured document corpora.
4. **Plan for hybrid search.** Pure vector search misses exact matches. BM25 + vector search (hybrid) consistently outperforms either alone for most real-world document Q&A tasks.

RAG is genuinely useful and the tooling around it has matured significantly in the past two years. The hard parts aren't the parts that get written about most — they're in the parsing, the evaluation, and the production data handling.
