package main.java.com.rmmarkets.market.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Collections;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

@Component
public class MarketWebSocketHandler extends TextWebSocketHandler {
    private final Set<WebSocketSession> sessions = Collections.synchronizedSet(new HashSet<>());
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, org.springframework.web.socket.CloseStatus status) {
        sessions.remove(session);
    }

    @Scheduled(fixedRate = 2000)
    public void pushMarketUpdates() {
        if (sessions.isEmpty()) return;
        Map<String, Object> update = Map.of(
                "symbol", "BTCUSD",
                "price", Math.round((22000 + Math.random() * 1000) * 100.0) / 100.0,
                "timestamp", System.currentTimeMillis());

        try {
            String payload = objectMapper.writeValueAsString(update);
            synchronized (sessions) {
                for (WebSocketSession session : sessions) {
                    if (session.isOpen()) {
                        session.sendMessage(new TextMessage(payload));
                    }
                }
            }
        } catch (IOException e) {
            // ignore
        }
    }
}
