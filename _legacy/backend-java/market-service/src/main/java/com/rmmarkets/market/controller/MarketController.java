package com.rmmarkets.market.controller;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/market")
public class MarketController {

    @GetMapping("/ticker")
    public ResponseEntity<?> ticker(@RequestParam String symbol) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("symbol", symbol.toUpperCase());
        payload.put("price", Math.round((100 + Math.random() * 900) * 100.0) / 100.0);
        payload.put("timestamp", System.currentTimeMillis());
        return ResponseEntity.ok(payload);
    }

    @GetMapping("/history")
    public ResponseEntity<?> history(@RequestParam String symbol) {
        Map<String, Object> sample = new HashMap<>();
        sample.put("symbol", symbol.toUpperCase());
        sample.put("candles", new double[][]{{100, 105, 98, 102}, {102, 110, 101, 108}, {108, 112, 107, 111}});
        return ResponseEntity.ok(sample);
    }

    @GetMapping(path = "/price-stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamPrice(@RequestParam(defaultValue = "BTCUSD") String symbol) {
        SseEmitter emitter = new SseEmitter();
        new Thread(() -> {
            try {
                for (int i = 0; i < 100; i++) {
                    Map<String, Object> event = Map.of(
                            "symbol", symbol.toUpperCase(),
                            "price", Math.round((10000 + Math.random() * 500) * 100.0) / 100.0,
                            "timestamp", System.currentTimeMillis());
                    emitter.send(event);
                    Thread.sleep(1000);
                }
                emitter.complete();
            } catch (IOException | InterruptedException e) {
                emitter.completeWithError(e);
            }
        }).start();
        return emitter;
    }
}
