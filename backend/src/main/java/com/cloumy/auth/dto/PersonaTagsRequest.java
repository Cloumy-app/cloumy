package com.cloumy.auth.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

public record PersonaTagsRequest(@NotNull List<String> tags) {}
