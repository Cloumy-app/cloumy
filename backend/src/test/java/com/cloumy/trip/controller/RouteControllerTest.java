package com.cloumy.trip.controller;

import com.cloumy.common.exception.GlobalExceptionHandler;
import com.cloumy.trip.service.AiServiceClient;
import com.cloumy.trip.service.FallbackRouteService;
import com.cloumy.trip.service.RouteDaySummaryService;
import com.cloumy.trip.service.RouteService;
import com.cloumy.trip.service.RouteSlotService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// A-1 회귀 테스트 — routes.budget_level CHECK 5종 확장(V22) 이전에는 tight/luxury 같은
// DB 미지원 값이 INSERT까지 내려가 500으로 죽었다. @Pattern 검증이 요청 단계에서
// 먼저 막아 세우는지 확인한다. 스프링 컨텍스트 전체를 띄우지 않고 standalone MockMvc로
// 컨트롤러 + 실제 Bean Validation + GlobalExceptionHandler만 조합해 검증한다
// (CloudmyApplication의 @EnableJpaAuditing이 슬라이스 테스트에도 딸려 와 컨텍스트 로딩이 무거워짐).
@ExtendWith(MockitoExtension.class)
class RouteControllerTest {

    @Mock
    private RouteService routeService;
    @Mock
    private RouteSlotService routeSlotService;
    @Mock
    private RouteDaySummaryService routeDaySummaryService;
    @Mock
    private AiServiceClient aiServiceClient;
    @Mock
    private FallbackRouteService fallbackRouteService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        RouteController controller = new RouteController(
                routeService, routeSlotService, routeDaySummaryService, aiServiceClient, fallbackRouteService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler())
                .setValidator(new LocalValidatorFactoryBean())
                .build();
    }

    @Test
    void generateRouteWithInvalidBudgetLevelReturnsClientError() throws Exception {
        String requestBody = """
                {
                    "destination": "서울",
                    "startDate": "2026-09-01",
                    "endDate": "2026-09-03",
                    "groupType": "solo",
                    "budgetLevel": "ultra_luxury"
                }
                """;

        mockMvc.perform(post("/v1/routes/generate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                // GlobalExceptionHandler가 @Valid 실패를 422(UNPROCESSABLE_ENTITY)로 응답한다.
                // 수정 전에는 CHECK 위반이 INSERT까지 내려가 500이었다 — 500만 아니면 회귀는 막힌 것.
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.error.code").value("INVALID_INPUT"));
    }
}
