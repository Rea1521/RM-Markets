package com.rmmarkets.news.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/news")
public class NewsController {

    @GetMapping("/headlines")
    public ResponseEntity<?> headlines() {
        List<Map<String, String>> news = List.of(
                Map.of("title", "Global markets rally on renewed optimism", "source", "Reuters"),
                Map.of("title", "New crypto regulations proposed in EU", "source", "Bloomberg")
        );
        return ResponseEntity.ok(news);
    }

    @GetMapping("/calendar")
    public ResponseEntity<?> calendar() {
        List<Map<String, String>> events = List.of(
                Map.of("date", "2026-03-20", "event", "FOMC rate decision"),
                Map.of("date", "2026-03-25", "event", "US GDP release")
        );
        return ResponseEntity.ok(events);
    }
}
