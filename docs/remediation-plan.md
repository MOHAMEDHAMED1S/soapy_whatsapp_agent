# خطة الإصلاح الشاملة والآمنة - Soapy WhatsApp Agent

**المرجع:** تقرير التدقيق (`docs/audit-report.md`)  
**الإصدار:** 2.0  
**تاريخ:** 5 يونيو 2026  
**إجمالي المشاكل:** 22  
**إجمالي الملفات المتأثرة:** 7  

---

## هيكلية الخطة

كل مشكلة في هذه الخطة تتضمن:
- **الأعراض (Symptoms):** كيف تكتشف المشكلة في الإنتاج
- **تحليل السبب الجذري (Root Cause):** لماذا تحدث
- **الإصلاح الآمن (Secure Fix):** كود محدد مع مراعاة الأمان
- **كيفية التحقق (Verification):** خطوات اختبار الإصلاح
- **التبعيات (Dependencies):** ما يجب إصلاحه أولاً

---

## المحتويات

- [المرحلة 0: إعدادات الأمان الأساسية (قبل كل شيء)](#المرحلة-0-إعدادات-الأمان-الأساسية)
- [المرحلة 1: إصلاحات حرجة (CRITICAL)](#المرحلة-1-إصلاحات-حرجة-critical)
- [المرحلة 2: إصلاحات عالية الأولوية (HIGH)](#المرحلة-2-إصلاحات-عالية-الأولوية-high)
- [المرحلة 3: إصلاحات متوسطة (MEDIUM)](#المرحلة-3-إصلاحات-متوسطة-medium)
- [المرحلة 4: إصلاحات منخفضة (LOW)](#المرحلة-4-إصلاحات-منخفضة-low)

---

# المرحلة 0: إعدادات الأمان الأساسية (قبل كل شيء)

هذه الإعدادات يجب تطبيقها أولاً لأنها تمنع تصعيد الأخطاء إلى ثغرات أمنية.

## P0.1: أداة Timeout آمنة مع منع الإكمال المتأخر

**المبدأ الأمني:** أي عملية يمكن أن تعلق (hang) يجب أن يكون لها `timeout`. لكن `Promise.race()` لا تلغي الـ Promise الأصلي—يستمر في الخلفية وقد يكتمل لاحقاً ويؤثر على الحالة الجديدة.

### أداة الـ Timeout الآمنة مع AbortController

**الملف الجديد:** `src/utils/timeout.ts`

```typescript
export interface TimeoutResult {
  aborted: boolean;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage: string
): Promise<T> {
  let timer: NodeJS.Timeout;
  const abortResult: TimeoutResult = { aborted: false };

  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      abortResult.aborted = true;
      reject(new Error(`TIMEOUT: ${errorMessage} after ${ms}ms`));
    }, ms);
  });

  // نلف الـ promise الأصلي لنتجاهل نتيجته إذا كان قد أُلغي
  const wrappedPromise = promise.then(
    (result) => {
      clearTimeout(timer);
      if (abortResult.aborted) {
        logger.warn(`IGNORED: "${errorMessage}" completed after timeout was triggered`);
        // نرمي خطأ بدلاً من إعادة النتيجة—المتصل تجاهلنا بالفعل
        throw new Error(`Operation completed but was already aborted: ${errorMessage}`);
      }
      return result;
    },
    (error) => {
      clearTimeout(timer);
      throw error;
    }
  );

  return Promise.race([wrappedPromise, timeoutPromise]);
}

// دالة مساعدة لقتل العمليات بعد timeout
export function killProcess(namePattern: string): void {
  const { execSync } = require('child_process');
  if (process.platform === 'win32') {
    execSync(`taskkill /F /FI "WINDOWTITLE eq ${namePattern}" /T 2>nul || ver >nul`, { stdio: 'ignore' });
  } else {
    execSync(`pkill -9 -f "${namePattern}" || true`, { stdio: 'ignore' });
  }
}
```

**لماذا هذا ضروري:** بدون `abortResult`، إذا اكتمل `pupBrowser.close()` بعد timeout، قد يغلق المتصفح الجديد! الـ `abortResult.aborted` يضمن تجاهل الإكمال المتأخر تماماً.

---

# المرحلة 1: إصلاحات حرجة (CRITICAL)

هذه المشاكل تسبب **فقدان كامل للخدمة (Complete Service Outage)** أو **فقدان دائم للبيانات**.

---

## CRIT-1: `WhatsAppBot.destroy()` يعلق ← PM2 لا يستطيع إعادة التشغيل ← الخدمة معطلة

**الملف:** `src/bot/WhatsAppBot.ts:614-665`

### الأعراض
- PM2 يرسل SIGTERM، التطبيق لا يخرج (لا يظهر `process.exit`)
- بعد المهلة، PM2 يرسل SIGKILL
- ملفات القفل (`SingletonLock`) تبقى ← إعادة التشغيل التالية تفشل بـ "browser already running"
- حلقة إعادة تشغيل لا نهائية ← PM2 يتوقف بعد 15 محاولة ← الخدمة معطلة بالكامل

### السبب الجذري
`await this.client.destroy()` في السطر 648 يعلق عندما يكون متصفح Chromium متجمداً. لا يوجد أي `timeout` يحرر التطبيق.

### الإصلاح الآمن — مع قتل العملية بعد timeout

**⚠️ مهم:** إزالة `SingletonLock` بدون قتل Chromium المتجمد يجعل المشكلة أسوأ—المتصفح الجديد لن يستطيع فتح الـ session لأن العملية القديمة لا تزال تحتكر الدليل. الحل: **اقتل العملية أولاً، ثم أزل القفل.**

**الملف:** `src/bot/WhatsAppBot.ts:614-665`

```typescript
import { withTimeout, killProcess } from '../utils/timeout';

async destroy(): Promise<void> {
    let browserForceKilled = false;
    try {
        this.stopHealthCheck();
        this.clearAllTypingSessions();

        if (!this.client) {
            this.isReady = false;
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            return;
        }

        // 1. محاولة إغلاق طبيعي مع timeout
        try {
            const clientAny = this.client as any;
            if (clientAny.pupBrowser) {
                logger.info('Closing Puppeteer browser...');
                await withTimeout(
                    clientAny.pupBrowser.close(),
                    5000,
                    'Puppeteer browser.close()'
                );
            }
            logger.info('Closing WhatsApp client...');
            await withTimeout(
                this.client.destroy(),
                10000,
                'WhatsApp client.destroy()'
            );
            logger.info('Graceful destroy completed');
        } catch (closeError) {
            logger.warn('Graceful close failed, force killing browser:', closeError.message);
            browserForceKilled = true;
            // 2. قتل العملية بالقوة—هذا هو خطوة الأمان الحقيقية
            this.killBrowserProcesses();
        }

        // 3. الآن وبعد أن انتهت العملية، أزل القفل بأمان
        this.removeBrowserLockFiles();

        this.isReady = false;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        logger.info(`WhatsApp bot destroyed (method: ${browserForceKilled ? 'force-kill' : 'graceful'})`);
    } catch (error) {
        // آخر خط دفاع—نتأكد من قتل العملية وإزالة القفل
        logger.error('Fatal error in destroy:', error);
        try { this.killBrowserProcesses(); } catch {}
        try { this.removeBrowserLockFiles(); } catch {}
    }
}

// دالة مساعدة لقتل عمليات Chromium بالقوة
private killBrowserProcesses(): void {
    const sessionPath = path.resolve('./.wwebjs_auth');
    killProcess('chromium.*wwebjs_auth');
    killProcess('chrome.*wwebjs_auth');
    killProcess('Google Chrome.*wwebjs_auth');
    killProcess('Chromium.*wwebjs_auth');
    // انتظر قصير للتأكد من انتهاء العمليات
    execSync('sleep 1 || timeout /T 1 >nul 2>&1 || true', { stdio: 'ignore' });
}
```

### التحقق
1. شغّل البوت
2. جمّد Chromium: `kill -STOP $(pgrep -f chromium)`
3. أرسل SIGTERM
4. تأكد أن `destroy()` يخرج خلال < 12 ثانية
5. تأكد أن عملية Chromium قُتلت (`pgrep -f chromium` لا يعيد شيئاً)
6. تأكد من إزالة `SingletonLock`
7. تأكد أن PM2 يعيد التشغيل بنجاح (المتصفح الجديد يفتح session جديد)

### التبعيات
- P0.1 (أداة `withTimeout` مع `killProcess`)

---

## CRIT-2: `processMessage()` يعلق ← قائمة انتظار الرقم تُحجب للأبد

**الملف:** `src/bot/MessageHandler.ts:84-88`

### الأعراض
- المستخدم يرسل رسالة، البوت يبدأ في الرد لكنه لا يرسل شيئاً
- جميع الرسائل اللاحقة من نفس الرقم لا تُعالج (البوت يتجاهلها)
- لا يوجد خطأ في السجلات—فقط `DEBUG Message from X is queued` يتكرر
- `this.activeProcessingCount` لا ينخفض
- إعادة تشغيل البوت هو الحل الوحيد

### السبب الجذري
`await processPromise` في السطر 85 يعلق عندما تعلق `sendMessage()` (Chromium متجمد). `finally` الذي يحذف من `processingQueue` لا يُنفذ أبداً.

### الإصلاح الآمن — مع Token System للإلغاء

**⚠️ خطر:** بدون Token، إذا اكتملت `processMessage` القديمة بعد timeout، سترسل رداً قديماً لمستخدم جديد. الحل: Token يربط كل معالجة برسالتها.

**الملف:** `src/bot/MessageHandler.ts`

إضافة خاصية جديدة في الـ class:

```typescript
export class MessageHandler {
  private processingQueue: Map<string, Promise<void>> = new Map();
  // Token system: كل رقم هاتف له token يمثل المعالجة الحالية الصالحة
  private processingTokens: Map<string, symbol> = new Map();
  private activeProcessingCount: number = 0;
  private readonly MAX_QUEUE_SIZE = 100; // حد أقصى للحماية من DoS
```

تحديث `handleMessage()`:

```typescript
async handleMessage(msg: Message): Promise<void> {
    try {
        const phone = this.extractPhoneNumber(msg.from);
        // ... باقي التحقق من الحظر والـ rate limit ...

        // حماية DoS: حد أقصى لحجم قائمة الانتظار
        if (this.processingQueue.size >= this.MAX_QUEUE_SIZE) {
            logger.warn(`Queue full (${this.MAX_QUEUE_SIZE}), message from ${phone} dropped`);
            return;
        }

        // إنشاء token فريد لهذه المعالجة
        const currentToken = Symbol(phone);

        // انتظار المعالجة السابقة (إن وجدت)
        const existingPromise = this.processingQueue.get(phone);
        if (existingPromise) {
            try {
                await withTimeout(existingPromise, 30000, 'Waiting for previous message');
            } catch (error) {
                // تجاهل—المعالجة السابقة فشلت أو timeout، نكمل
            }
        }

        this.activeProcessingCount++;

        // إنشاء promise المعالجة مع token
        const processPromise = this.processMessage(phone, userMessage, chatId, msg)
            .finally(() => {
                // نتحقق: هل هذه المعالجة لا تزال صالحة؟
                if (this.processingTokens.get(phone) === currentToken) {
                    this.processingQueue.delete(phone);
                    this.processingTokens.delete(phone);
                    this.activeProcessingCount = Math.max(0, this.activeProcessingCount - 1);
                }
            });

        // تسجيل token كـ "الصالح حالياً"
        this.processingTokens.set(phone, currentToken);
        this.processingQueue.set(phone, processPromise);

        // timeout لمنع التعليق للأبد
        const TIMEOUT_MS = 60000;
        const timeoutPromise = new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`TIMEOUT: Message processing for ${phone} exceeded ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
        );

        try {
            await Promise.race([processPromise, timeoutPromise]);
        } catch (error: any) {
            // إبطال token—هذه المعالجة لم تعد صالحة
            // إذا اكتملت لاحقاً، finally سيرى أن token مختلف ولن ينظف
            this.processingTokens.delete(phone);
            this.processingQueue.delete(phone);
            this.activeProcessingCount = Math.max(0, this.activeProcessingCount - 1);
            logger.error(`Timeout or error processing message from ${phone}:`, error.message);
        }
    } catch (error) {
        logger.error('Error handling message:', error);
    }
}
```

### لماذا Symbol؟
- `Symbol(phone)` ينشئ معرفاً فريداً في كل مرة—حتى لو كان لنفس الرقم
- `this.processingTokens.get(phone) === currentToken` يضمن أن التنظيف يحدث فقط للمعالجة الصحيحة
- إذا بدأت معالجة جديدة (رسالة جديدة)، الـ token يتغير ← المعالجة القديمة لن تنظف الـ queue

### التحقق
1. أرسل رسالة من المستخدم
2. أثناء المعالجة، جمّد Chromium: `kill -STOP $(pgrep -f chromium)`
3. أرسل رسالة ثانية من نفس المستخدم—يجب أن تُعالج فوراً (الرسالة الأولى timeout)
4. بعد 60 ثانية، حرّر Chromium: `kill -CONT $(pgrep -f chromium)`
5. تأكد أن الرد القديم **لم يُرسل** للمستخدم (لأن token أصبح غير صالح)
6. تأكد أن قائمة الانتظار تعمل للمستخدمين الآخرين

### التبعيات
- CRIT-1 (لأن `sendMessage` تعلق بسبب Chromium المتجمد)
- P0.1 (`withTimeout`)

---

## CRIT-3: `whatsappBot.destroy()` يرمي ← `databaseManager.close()` لا يُستدعى

**الملف:** `src/index.ts:24-25, 54-55`

### الأعراض
- تلف في ملف `conversations.db` (SQLite: "database disk image is malformed")
- فقدان محادثات بعد إعادة التشغيل
- خطأ `SQLITE_BUSY` عند بدء التشغيل التالي

### السبب الجذري
`destroy()` و `close()` في `try` بدون `finally`. عندما يرمي `destroy()`، `close()` لا يُنفذ.

### الإصلاح الآمن

**الملف:** `src/index.ts:16-31` — مع تتبع exit code:

```typescript
const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    let exitCode = 0;

    try {
        if (restartTimer) {
            clearInterval(restartTimer);
            restartTimer = null;
        }
        geminiService.stopAutoUpdate();
        await whatsappBot.destroy();
        logger.info('WhatsApp bot destroyed');
    } catch (error) {
        logger.error('Error during shutdown (continuing to close DB):', error);
        exitCode = 1; // فشل—PM2 سيرى exit code 1
    } finally {
        try {
            databaseManager.close();
            logger.info('Database closed');
        } catch (dbError) {
            logger.error('Error closing database:', dbError);
            exitCode = 1;
        }
        process.exit(exitCode);
    }
};
```

**نفس التعديل لـ `restartProcess()`:**

**الملف:** `src/index.ts:44-67`

```typescript
const restartProcess = async (reason: string) => {
    if (isRestarting) return;
    isRestarting = true;
    if (restartTimer) {
        clearInterval(restartTimer);
        restartTimer = null;
    }
    logger.info(`Restarting process (${reason})...`);
    let exitCode = 0;
    try {
        const drainTimeoutRaw = process.env.RESTART_DRAIN_TIMEOUT_MS || '20000';
        const drainTimeoutMs = Number(drainTimeoutRaw);
        if (Number.isFinite(drainTimeoutMs) && drainTimeoutMs > 0) {
            const drained = await messageHandler.waitForIdle(drainTimeoutMs);
            if (!drained) {
                logger.warn('Restart drain timeout reached, continuing with shutdown');
            }
        }
        geminiService.stopAutoUpdate();
        await whatsappBot.destroy();
    } catch (error) {
        logger.error('Error during restart cleanup:', error);
        exitCode = 1;
    } finally {
        try {
            databaseManager.close();
        } catch (dbError) {
            logger.error('Error closing database during restart:', dbError);
            exitCode = 1;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        process.exit(exitCode);
    }
};
```

**لماذا exit code مهم:** PM2 يعيد التشغيل فقط عند `process.exit(1)` أو crash. `process.exit(0)` يخبر PM2 أن كل شيء طبيعي ولن يعيد التشغيل إذا كان الـ auto-restart معطلاً.

### التحقق
1. أضف `throw new Error('simulated')` في `destroy()` (مؤقتاً)
2. استدع `shutdown('test')`
3. تأكد أن `databaseManager.close()` يُستدعى رغم الخطأ
4. تأكد من `process.exit(1)` (وليس 0)
5. أزل المحاكاة، تأكد من `process.exit(0)` عند النجاح

### التبعيات
- CRIT-1 (لأن `destroy` هو ما قد يرمي)

---

# المرحلة 2: إصلاحات عالية الأولوية (HIGH)

---

## HIGH-1: `uncaughtException` يحاول التعافي ← حالة البرنامج غير معروفة

**الملف:** `src/index.ts:88-91`

### الأعراض
- خطأ `uncaughtException` في السجلات
- `shutdown()` يُستدعى ويحاول إغلاق المتصفح وقاعدة البيانات
- المتصفح قد يكون في حالة فاسدة ← `destroy()` يرمي خطأ آخر
- قاعدة البيانات قد تُتلف بسبب الإغلاق في حالة غير مستقرة

### السبب الجذري
استدعاء `shutdown()` من `uncaughtException` مخالف لتوصيات Node.js. بعد `uncaughtException`، heap الـ V8 قد يكون فاسداً.

### الإصلاح الآمن

**⚠️ مهم:** `logger.error()` قد يكون async—إذا كان الـ logger يكتب إلى ملف، قد لا يكتب قبل `process.exit(1)`. استخدم `process.stderr.write()` (sync—مضمون).

```typescript
process.on('uncaughtException', (error) => {
    // استخدام stderr (sync)—مضمون الكتابة حتى لو الـ logger معطل
    try {
        process.stderr.write(`UNCAUGHT EXCEPTION: ${error.stack || error}\n`);
    } catch {}
    // لا نحاول shutdown—البرنامج في حالة غير معروفة وقد يكون heap فاسداً
    // PM2 سيعيد التشغيل—CRIT-1 يضمن عدم ترك Chromium يتيماً
    process.exit(1);
});
```

### التحقق
1. أضف `throw new Error('test')` في أي مكان في السطر الرئيسي
2. تأكد من تسجيل الخطأ ثم `process.exit(1)` فوراً
3. تأكد من PM2 يعيد التشغيل (exit code 1 يحفز إعادة التشغيل)

### التبعيات
- CRIT-1 (لأننا لم نعد نحاول `destroy()`، القفل قد يبقى—لذلك CRIT-1 مهم)

---

## HIGH-2: `unhandledRejection` فقط يسجل ← أخطاء صامتة تتراكم

**الملف:** `src/index.ts:93-95`

### الأعراض
- لا تظهر أي أعراض مباشرة
- بعض الدوال لا تُكمل تنفيذها بسبب Promise مرفوض
- قد تظهر نتائج غير متوقعة للمستخدمين
- تتراكم الأخطاء في الذاكرة

### السبب الجذري
`unhandledRejection` لا يخرج من العملية. الأخطاء تبقى صامتة.

### الإصلاح الآمن

**⚠️ مهم:** استخدام `setTimeout` غير مضمون—إذا كان Event Loop مشغولاً، `setTimeout` قد لا يُستدعى أبداً.

**الحل:** استخدم `--unhandled-rejections=strict`—هذا الخيار يجعل Node.js ينهي العملية فوراً عند أي `unhandledRejection` بدون الحاجة لـ handler أصلاً.

**الملف:** `package.json`

```json
{
  "scripts": {
    "start": "node --unhandled-rejections=strict dist/index.js",
    "dev": "node --unhandled-rejections=strict ts-node src/index.ts"
  }
}
```

ثم **احذف** handler الـ `unhandledRejection` من `src/index.ts` (السطور 93-95)—لم نعد نحتاجه.

**إذا أردت الاحتفاظ بالـ handler للتسجيل فقط:**

```typescript
process.on('unhandledRejection', (reason) => {
    try {
        process.stderr.write(`UNHANDLED REJECTION: ${reason}\n`);
    } catch {}
    // `--unhandled-rejections=strict` سينهي العملية تلقائياً بعد هذا
});
```

### التحقق
1. أضف `Promise.reject(new Error('test'))` دون `catch`
2. تأكد من تسجيل الخطأ ثم `process.exit(1)` بعد ثانية

---

## HIGH-3: `rateLimiterService.checkRateLimit()` fail-open ← سبام مسموح عند فشل DB

**الملف:** `src/services/RateLimiterService.ts:110-113`

### الأعراض
- خطأ `SQLITE_ERROR` أو `SQLITE_BUSY` في السجلات
- الحماية من السبام لا تعمل أثناء فترة الفشل
- مستخدم خبيث يمكنه إغراق البوت بالرسائل

### السبب الجذري
عند فشل قاعدة البيانات، `checkRateLimit()` تعيد `{ allowed: true }` مما يعني "دع كل الرسائل تمر". هذا تصميم `fail-open` خطير.

### الإصلاح الآمن (خياران)

**⚠️ خطر:** In-memory Map بدون تنظيف دوري يتسرب ذاكرة—مع 10,000 مستخدم، الـ Map سيحتوي على 10,000 مدخل إلى الأبد.

**الإصلاح الكامل:** In-memory fallback مع تنظيف دوري للذاكرة:

```typescript
export class RateLimiterService {
    private db = databaseManager.getDatabase();
    // In-memory fallback rate limiter
    private inMemoryCounts: Map<string, { count: number; windowStart: number }> = new Map();
    private readonly MEMORY_LIMIT_PER_MINUTE = 20;
    private lastCleanup: number = Date.now();
    private readonly CLEANUP_INTERVAL_MS = 60000; // تنظيف كل دقيقة

    async checkRateLimit(phone: string): Promise<{ allowed: boolean; reason?: string }> {
        try {
            return await this.checkRateLimitDb(phone);
        } catch (error) {
            logger.error('RATE_LIMIT_DB_ERROR: Fallback to in-memory for', phone);
            this.periodicCleanup(); // ← تنظيف الذاكرة قبل الاستخدام
            return this.checkRateLimitMemory(phone);
        }
    }

    // تنظيف المدخلات الأقدم من دقيقتين—يمنع تسريب الذاكرة
    private periodicCleanup(): void {
        const now = Date.now();
        if (now - this.lastCleanup < this.CLEANUP_INTERVAL_MS) return;
        this.lastCleanup = now;
        const threshold = now - 120000;
        let deleted = 0;
        for (const [phone, record] of this.inMemoryCounts.entries()) {
            if (record.windowStart < threshold) {
                this.inMemoryCounts.delete(phone);
                deleted++;
            }
        }
        if (deleted > 0) {
            logger.debug(`Cleaned up ${deleted} stale in-memory rate limit entries`);
        }
    }

    private checkRateLimitMemory(phone: string): { allowed: boolean; reason?: string } {
        const now = Date.now();
        const record = this.inMemoryCounts.get(phone);

        if (!record || (now - record.windowStart) > 60000) {
            this.inMemoryCounts.set(phone, { count: 1, windowStart: now });
            return { allowed: true };
        }

        record.count++;
        if (record.count > this.MEMORY_LIMIT_PER_MINUTE) {
            logger.warn(`In-memory rate limit exceeded for ${phone}: ${record.count} msgs/min`);
            return {
                allowed: false,
                reason: 'تم تجاوز الحد المسموح من الرسائل. يرجى الانتظار.',
            };
        }

        return { allowed: true };
    }
}
```

### ما الذي يمنعه هذا الإصلاح؟
- **تسريب الذاكرة:** `periodicCleanup()` يحذف المدخلات الأقدم من دقيقتين
- **هجوم السبام:** حد 20 رسالة/الدقيقة حتى عند فشل DB
- **الفشل الصامت:** يتم تسجيل كل فشل DB مع وسم `RATE_LIMIT_DB_ERROR`

### التحقق
1. أوقف قاعدة البيانات: `mv data/conversations.db data/conversations.db.bak`
2. أرسل 21 رسالة من نفس الرقم خلال دقيقة
3. تأكد من رفض الرسالة 21
4. أعد تشغيل DB: `mv data/conversations.db.bak data/conversations.db`
5. أرسل رسالة—تأكد من العودة إلى use DB rate limiter
6. اختبر تسريب الذاكرة: محاكاة 10,000 مستخدم، تأكد أن الـ Map لا يتجاوز 10,000 + 100

---

## HIGH-4: ApiService ثلاثة أنماط مختلفة لمعالجة الأخطاء

**الملف:** `src/services/ApiService.ts`

### الأعراض
- المتصل بـ `calculateShippingCost` ينسى `try/catch` → استثناء غير معالج يصل إلى `uncaughtException`
- المتصل بـ `calculateTotal` لا يتحقق من `response.success` → بيانات خاطئة تمر إلى المستخدم
- صيانة الكود صعبة لأن كل دالة تتصرف بشكل مختلف

### السبب الجذري
لا يوجد معيار موحد لمعالجة أخطاء API. بعض الدوال ترمي، بعضها يعيد `{ success: false }`، وبعضها يفعل كليهما.

### ⚠️ هذا تغيير Breaking — يحتاج 3 مراحل

**الخطر:** المتصلون الحاليون (مثل `GeminiService.ts`) يستخدمون `try/catch` مع الدوال التي ترمي. إذا غيرنا الدالة لتعيد `{ success: false }` بدون رمي، الـ `catch` لن يُستدعى أبداً والكود سيستخدم `response.data` الفارغ بصمت.

**الإصلاح على 3 مراحل:**

#### المرحلة 1: إضافة دوال جديدة آمنة (بدون حذف القديمة)

```typescript
// ApiService.ts — أضف دوال Safe بجانب القديمة
async createOrderSafe(request: CreateOrderRequest): Promise<ApiResponse<CreateOrderResponse>> {
    try {
        const response = await this.client.post<...>('/checkout/create-order', request);
        return response.data;
    } catch (error: any) {
        logger.error('Error creating order:', error.message);
        return {
            success: false,
            message: error.response?.data?.message || error.message || 'Failed to create order',
            errors: error.response?.data?.errors,
            data: {} as CreateOrderResponse,
        };
    }
}

// كرر لكل دالة: getProductsSafe, initiatePaymentSafe, ...
```

#### المرحلة 2: تحويل المتصلين واحداً تلو الآخر

```typescript
// GeminiService.ts — استخدم createOrderSafe بدلاً من createOrder
const orderResponse = await apiService.createOrderSafe(orderData);
if (!orderResponse.success) {
    return `حدث خطأ: ${orderResponse.message}`;
}
```

**راجع كل متصل:** ابحث عن جميع استدعاءات ApiService في الكود:

```bash
grep -rn "apiService\." src/ --include="*.ts"
```

تأكد من تحديث كل متصل قبل الانتقال للمرحلة 3.

#### المرحلة 3: حذف الدوال القديمة وإعادة التسمية

```typescript
// بعد تحديث جميع المتصلين:
// 1. احذف createOrder القديمة (التي ترمي)
// 2. أعد تسمية createOrderSafe → createOrder
// 3. اختبر أن `npm run build` يمر
```

### التحقق لكل مرحلة
1. **المرحلة 1:** `npm run build`—يجب أن يمر بدون أخطاء (الدوال الجديدة لا تؤثر على القديمة)
2. **المرحلة 2:** لكل متصل تم تحديثه، اختبر السيناريو: قطع الاتصال بالإنترنت، تأكد من عدم ظهور `uncaughtException`
3. **المرحلة 3:** `npm run build`—يجب أن يفشل إذا نسي متصل واحد استخدام الدالة الجديدة

---

## HIGH-5: `createOrder()` ينجح ← `initiatePayment()` يرمي ← الطلب يُفقد محلياً

**الملف:** `src/services/GeminiService.ts:1220-1437`

### الأعراض
- الطلب موجود في API لكن ليس في قاعدة البيانات المحلية
- المستخدم يرى "حدث خطأ في إنشاء الطلب" رغم أن الطلب أُنشئ فعلاً
- المستخدم لا يستطيع تتبع الطلب عبر البوت

### السبب الجذري
`initiatePayment()` قد يرمي استثناءً (مثلاً API الدفع معطلة). الاستثناء ينتقل إلى `catch` الخارجي (سطر 1437) حيث لا يُستدعى `saveOrder()`.

### ⚠️ خطر: `saveOrder()` نفسه قد يفشل (خطأ DB) بعد نجاح `createOrder()`

إذا فشل `saveOrder()`، الطلب موجود في API لكن ليس في DB المحلية. الحل: تخزين مؤقت في الذاكرة قبل أي استدعاء API.

**الإصلاح — تخزين مؤقت في الذاكرة كـ fallback:**

```typescript
// في GeminiService—خريطة للطلبات المعلقة
private pendingOrders: Map<string, {
    phone: string;
    orderId?: number;
    data?: any;
    status: 'creating' | 'pending' | 'failed';
    createdAt: number;
}> = new Map();

// في دالة create_order:
// الخطوة 0: إنشاء سجل مؤقت في الذاكرة (قبل أي API call)
const pendingKey = `${customerPhone}_${Date.now()}`;
this.pendingOrders.set(pendingKey, {
    phone: customerPhone,
    status: 'creating',
    createdAt: Date.now(),
});

try {
    // الخطوة 1: إنشاء الطلب في API
    const orderResponse = await apiService.createOrderSafe({...});
    if (!orderResponse.success) {
        this.pendingOrders.delete(pendingKey);
        return `حدث خطأ في إنشاء الطلب: ${orderResponse.message}`;
    }

    const orderData = orderResponse.data;

    // الخطوة 2: حفظ في DB—إذا فشل، لدينا pending order في الذاكرة
    try {
        conversationRepository.saveOrder(
            orderData.order.id,
            customerPhone,
            orderData,
            undefined,
            'pending'
        );
        this.pendingOrders.delete(pendingKey); // تم الحفظ—أزل من الذاكرة
    } catch (saveError) {
        // نبقيه في pendingOrders—سنحاول الحفظ لاحقاً
        this.pendingOrders.set(pendingKey, {
            phone: customerPhone,
            orderId: orderData.order.id,
            data: orderData,
            status: 'pending',
            createdAt: Date.now(),
        });
        logger.error('DB save failed, order kept in memory:', saveError);
    }

    // الخطوة 3: الدفع (مستقل)
    let paymentUrl: string | undefined;
    try {
        const paymentMethodsResponse = await apiService.getPaymentMethods();
        if (paymentMethodsResponse.success) {
            const firstMethod = Object.values(paymentMethodsResponse.data)[0];
            if (firstMethod) {
                const paymentResponse = await apiService.initiatePaymentSafe({
                    order_id: orderData.order.id,
                    payment_method: firstMethod.PaymentMethodCode,
                    customer_ip: config.customer.ip,
                    user_agent: 'WhatsApp-Bot',
                });
                if (paymentResponse.success) {
                    paymentUrl = paymentResponse.data.payment_url;
                    conversationRepository.saveOrder(
                        orderData.order.id, customerPhone, orderData,
                        paymentUrl, 'payment_pending'
                    );
                }
            }
        }
    } catch (paymentError) {
        logger.error('Payment failed, order is saved:', paymentError);
    }

    // الخطوة 4: رسالة الرد
    let message = `تم إنشاء طلبك بنجاح!\nرقم الطلب: ${orderData.order.order_number}\n`;
    if (paymentUrl) {
        message += `\nرابط الدفع:\n${paymentUrl}`;
    } else {
        message += `\nسيتم إرسال رابط الدفع قريباً.`;
    }
    return message;

} catch (error) {
    // خطأ غير متوقع—نحتفظ بـ pending order للمراجعة
    logger.error('Fatal error in order creation:', error);
    return `حدث خطأ في إنشاء الطلب. يرجى المحاولة مرة أخرى.`;
}
```

**إضافة استعادة الطلبات المعلقة عند بدء التشغيل:**

```typescript
// في startAutoUpdate أو initialize:
setInterval(() => {
    const now = Date.now();
    for (const [key, pending] of this.pendingOrders.entries()) {
        // الطلبات الأقدم من 30 دقيقة—حاول الحفظ مرة أخيرة
        if (pending.status === 'pending' && (now - pending.createdAt) > 1800000) {
            try {
                conversationRepository.saveOrder(
                    pending.orderId!, pending.phone, pending.data,
                    undefined, 'pending'
                );
                this.pendingOrders.delete(key);
                logger.info(`Recovered pending order ${pending.orderId} for ${pending.phone}`);
            } catch (e) {
                logger.error(`Failed to recover pending order ${pending.orderId}:`, e);
                this.pendingOrders.delete(key); // نتخلى بعد 30 دقيقة
            }
        }
        // الطلبات الفاشلة—احذف بعد 30 دقيقة
        if (pending.status === 'failed' || pending.status === 'creating') {
            if ((now - pending.createdAt) > 1800000) {
                this.pendingOrders.delete(key);
            }
        }
    }
}, 300000); // كل 5 دقائق
```

### التحقق
1. اعترض `saveOrder()` لترمي خطأ
2. أنشئ طلباً
3. تأكد من أن `pendingOrders` يحتوي على الطلب
4. تأكد من أن المستخدم يرى رسالة نجاح (وليس خطأ)
5. أصلح `saveOrder()`، انتظر 5 دقائق—تأكد من استرداد الطلب من `pendingOrders`
6. تأكد أن `pendingOrders` لا يتسرب ذاكرة (الطلبات الأقدم من 30 دقيقة تُحذف)

---

## HIGH-6: System Prompt يتضخم مع كثرة المنتجات

**الملف:** `src/services/GeminiService.ts:61-89`

### الأعراض
- خطأ `400 Bad Request` من Gemini API (تجاوز حد الـ tokens)
- تكلفة API عالية جداً (كل منتج يضيف ~150-200 tokens)
- استجابة Gemini بطيئة لأن الـ context كبير

### السبب الجذري
جميع المنتجات تُدرج في System Prompt بدون أي حد أقصى.

### ⚠️ خطر: الـ AI سيقول "هذا المنتج غير متوفر" لمنتج غير معروض

بدون دالة بحث، الـ AI يرى فقط 50 منتجاً. إذا سأل المستخدم عن منتج #51، سيفترض الـ AI أنه غير موجود.

**الإصلاح — حد 50 منتج + دالة `search_products` للـ AI:**

```typescript
private readonly MAX_PRODUCTS_IN_PROMPT = 50;

async updateProductCatalog(forceRefresh: boolean = false): Promise<void> {
    if (this.updateInProgress) return;
    this.updateInProgress = true;
    try {
        logger.info('Updating product catalog...');
        const products = await productService.getAllProducts(forceRefresh);
        if (products.length > 0) {
            // عرض أول 50 منتج فقط
            const productsForPrompt = products.slice(0, this.MAX_PRODUCTS_IN_PROMPT);
            const catalogText = productsForPrompt.map((p) => {
                // ... نفس كود التنسيق الحالي ...
            }).join('\n');

            const totalCount = products.length;
            // System Prompt مع تعليمات واضحة للـ AI
            this.productCatalog =
`قائمة المنتجات المتاحة (${Math.min(totalCount, this.MAX_PRODUCTS_IN_PROMPT)} من أصل ${totalCount} منتج):
${catalogText}

${totalCount > this.MAX_PRODUCTS_IN_PROMPT
    ? `تنبيه: هناك ${totalCount - this.MAX_PRODUCTS_IN_PROMPT} منتج آخر غير معروض.
إذا طلب العميل منتجاً معيناً وليس في القائمة أعلاه:
1. لا تفترض أنه غير متوفر
2. استخدم دالة "search_products" للبحث عنه
3. إذا لم تجد نتيجة، اسأل العميل عن اسم أكثر تحديداً`
    : ''}`;

            this.systemPrompt = this.getSystemPrompt();
            logger.info(`Product catalog: ${productsForPrompt.length}/${products.length} products displayed`);
        }
    } finally {
        this.updateInProgress = false;
    }
}
```

**إضافة دالة `search_products` في declaration الـ Gemini functions:**

```typescript
// في generateResponseWithFunctions:
const chat = model.startChat({
    history: [...],
    tools: [{
        functionDeclarations: [
            // ... الدوال الموجودة ...
            {
                name: 'search_products',
                description: 'ابحث عن منتج في القائمة الكاملة للمتجر. استخدم هذه الدالة عندما يسأل العميل عن منتج غير موجود في القائمة المعروضة.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'كلمة البحث—اسم المنتج أو جزء منه',
                        },
                    },
                    required: ['query'],
                },
            },
        ],
    }],
});
```

**معالجة نتيجة `search_products`:**

```typescript
// في executeFunction:
case 'search_products': {
    try {
        const query = args.query;
        const allProducts = await productService.getAllProducts();
        const results = allProducts
            .filter(p => (p.title || p.name || '').toLowerCase().includes(query.toLowerCase()))
            .slice(0, 5); // أقصى 5 نتائج

        if (results.length === 0) {
            return `لم أجد منتجات تطابق "${query}". هل يمكنك توضيح الاسم أكثر؟`;
        }

        let response = `نتائج البحث عن "${query}":\n`;
        results.forEach((p, i) => {
            const name = p.title || p.name_ar || p.name;
            const price = p.sale_price || parseFloat(p.price as string) || 0;
            response += `${i + 1}. ${name} - ${price} د.ك (رقم: ${p.id})\n`;
        });
        return response;
    } catch (error) {
        logger.error('Error searching products:', error);
        return 'عذراً، حدث خطأ أثناء البحث عن المنتج. يرجى المحاولة مرة أخرى.';
    }
}
```

### التحقق
1. أضف 100+ منتج—تأكد من عرض 50 فقط في System Prompt
2. اسأل الـ AI: "هل عندكم منتج اسمه X" حيث X من المنتجات غير المعروضة
3. تأكد من أن الـ AI يستخدم `search_products` ويجد المنتج
4. اختبر استعلام بدون منتجات مطابقة—تأكد من أن الـ AI يقول "لم أجد" وليس "غير متوفر"

---

## HIGH-7: PM2 ecosystem config

**الملف الجديد:** `ecosystem.config.js`

### الأعراض
- PM2 يتوقف عن إعادة التشغيل بعد 15 محاولة خلال 60 ثانية
- لا توجد مهلة kill_timeout—التطبيق يعلق عند SIGTERM

### الإصلاح الآمن

إنشاء `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'soapy-whatsapp-agent',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'fork',

    // وقت انتظار الإيقاف الآمن (ms)
    // CRIT-1: destroy() قد يستغرق حتى 12 ثانية—أعط 20 ثانية buffer
    kill_timeout: 20000,

    // إعدادات إعادة التشغيل
    max_restarts: 10,        // أقصى 10 محاولات
    min_uptime: 30000,       // يعتبر "مستقراً" بعد 30 ثانية
    restart_delay: 5000,     // انتظر 5 ثوانٍ بين المحاولات
    autorestart: true,

    // السجلات—تأكد من وجود مجلد logs/
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,

    // إعدادات البيئة
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--unhandled-rejections=strict',
    },
  }],
};
```

**تحديث `package.json`:** أضف إنشاء مجلد logs تلقائياً

```json
{
  "scripts": {
    "postinstall": "mkdir -p logs",
    "start": "mkdir -p logs && pm2 start ecosystem.config.js",
    "stop": "pm2 stop ecosystem.config.js",
    "restart": "pm2 restart ecosystem.config.js",
    "build": "tsc",
    "dev": "node --unhandled-rejections=strict ts-node src/index.ts",
    "watch": "tsc --watch"
  }
}
```

### التحقق
1. شغّل `mkdir -p logs && pm2 start ecosystem.config.js`
2. تأكد من أن العملية تعمل: `pm2 list`
3. أرسل SIGTERM: `pm2 stop soapy-whatsapp-agent`
4. تأكد من أن العملية تخرج خلال 20 ثانية (وليس 30+)
5. تأكد من وجود `./logs/err.log` و `./logs/out.log`

---

# المرحلة 3: إصلاحات متوسطة (MEDIUM)

---

## MED-1: رد Gemini فارغ يُرسل للعميل

**الملف:** `src/bot/MessageHandler.ts:192-196`

### الأعراض
- المستخدم يرى رسالة فارغة
- أو `whatsapp-web.js` يرمي خطأ مع رسالة فارغة

### الإصلاح

```typescript
// تعيين رد افتراضي إذا كان الرد فارغاً
const replyText = response.text?.trim() || 'عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى.';

await whatsappBot.sendMessage(replyTo, replyText);
conversationManager.addMessage(phone, 'assistant', replyText);
```

---

## MED-2: إرسال رسالة خطأ في `catch` قد يفشل بدون fallback

**الملف:** `src/bot/MessageHandler.ts:210-215`

### الأعراض
- خطأ في `catch` الداخلي ← يقفز إلى `catch` الخارجي
- لا توجد رسالة خطأ تُرسل للعميل
- المستخدم لا يعلم بوجود مشكلة

### الإصلاح الآمن

```typescript
} catch (error: any) {
    logger.error('Error generating response:', error);
    await whatsappBot.clearTypingIndicator(replyTo);

    if (!blockedNumbersService.isBlocked(phone)) {
        const errorMessage = 'عذراً، حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى.';
        try {
            await whatsappBot.sendMessage(replyTo, errorMessage);
        } catch (sendError) {
            // حتى رسالة الخطأ فشلت—نسجل فقط ونستمر
            logger.error('Failed to send error message to user:', sendError);
        }
        try {
            conversationManager.addMessage(phone, 'assistant', errorMessage);
        } catch (addError) {
            logger.error('Failed to add error message to conversation:', addError);
        }
    }
}
```

---

## MED-3: جلسات typingSessions لا تُنظف عند قطع الاتصال

**الملف:** `src/bot/WhatsAppBot.ts:96-114`

### الأعراض
- سيل من الأخطاء: `Error refreshing typing indicator for X`
- استخدام CPU عالي بدون داعي

### الإصلاح

إضافة دالة تنظيف في الـ `disconnected` handler:

```typescript
this.client.on('disconnected', async (reason) => {
    this.isReady = false;

    // تنظيف جلسات الكتابة أولاً
    this.clearAllTypingSessions();

    // ... debounce ...
    const now = Date.now();
    if (now - this.lastDisconnectedTime < this.DISCONNECT_DEBOUNCE_MS) {
        return;
    }
    this.lastDisconnectedTime = now;

    logger.warn('WhatsApp client disconnected:', reason);
    this.stopHealthCheck();
    await this.reconnect();
});
```

مع إضافة الدالة:

```typescript
private clearAllTypingSessions(): void {
    this.typingSessions.forEach((session) => {
        clearInterval(session.interval);
    });
    this.typingSessions.clear();
    logger.debug('Cleared all typing sessions');
}
```

**أيضاً في `destroy()`:** استخدم `this.clearAllTypingSessions()` بدلاً من التكرار اليدوي.

---

## MED-4: تثبيت قيم RateLimiter مع التعليقات

**الملف:** `src/services/RateLimiterService.ts:17-19`

### الأعراض
- التعليقات تقول 5 رسائل/الدقيقة لكن القيمة 100
- المطور يعتقد أن الحماية أقوى مما هي عليه

### ⚠️ تغيير القيم قد يؤثر على المستخدمين الحقيقيين

جعل القيم قابلة للتعديل عبر Environment Variables:

```typescript
private config: RateLimitConfig = {
    maxMessagesPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE) || 20,
    maxMessagesPerWindow: Number(process.env.RATE_LIMIT_PER_WINDOW) || 100,
    windowSizeMinutes: Number(process.env.RATE_LIMIT_WINDOW_MINUTES) || 5,
    autoBlockThreshold: 3,
};
```

**تحديث `.env.example`:**

```env
# Rate Limiting
RATE_LIMIT_PER_MINUTE=20
RATE_LIMIT_PER_WINDOW=100
RATE_LIMIT_WINDOW_MINUTES=5
```

---

## MED-5: التبعية الدائرية WhatsAppBot.ts ↔ MessageHandler.ts

### الأعراض
- أي تعديل مستقبلي قد يسبب `undefined` صامت
- صعوبة في unit testing

### ⚠️ EventBus ليس الحل الأمثل—يسبب فقدان Type Safety وصعوبة تتبع التدفق

**لماذا EventBus سيء هنا:**
1. **الأحداث عبارة عن strings**—TypeScript لا يتحقق من صحتها أو من types الـ parameters
2. **التصحيح صعب**—لا يمكن تتبع `eventBus.emit('message', ...)` ← `eventBus.on('message', ...)` في الكود
3. **سباق (Race Condition)**—إذا سُجل handler بعد emit، يُفقد الحدث
4. **تغيير كبير**—يؤثر على كل ملف في `src/bot/`

**الحل الأفضل: Dependency Injection عبر `index.ts` (لا تبعية دائرية + Type Safety)**

#### WhatsAppBot.ts—لا يستورد MessageHandler

```typescript
export class WhatsAppBot {
    // handler يُحقن من الخارج—لا import مباشر
    private onMessageReceived?: (msg: Message) => Promise<void>;

    setMessageHandler(handler: (msg: Message) => Promise<void>): void {
        this.onMessageReceived = handler;
    }

    private setupEventHandlers(): void {
        // ... باقي الـ handlers ...

        this.client.on('message', async (msg: Message) => {
            if (this.onMessageReceived) {
                await this.onMessageReceived(msg);
            }
        });
    }
}
```

#### MessageHandler.ts—لا يستورد WhatsAppBot

```typescript
export class MessageHandler {
    // handler يُحقن من الخارج
    private sendMessageFn?: (phone: string, message: string) => Promise<any>;

    setSendMessageHandler(handler: (phone: string, message: string) => Promise<any>): void {
        this.sendMessageFn = handler;
    }

    private async processMessage(...): Promise<void> {
        // ...
        await this.sendMessageFn!(replyTo, response.text);
    }
}
```

#### index.ts—يربط كل شيء مع Type Safety كامل

```typescript
// index.ts—الملف الوحيد الذي يستورد كلا الملفين
import { whatsappBot } from './bot/WhatsAppBot';
import { messageHandler } from './bot/MessageHandler';

// حقن التبعيات—لا تبعية دائرية
whatsappBot.setMessageHandler((msg) => messageHandler.handleMessage(msg));
messageHandler.setSendMessageHandler((phone, text) => whatsappBot.sendMessage(phone, text));
```

**مزايا هذا الحل:**
- ✅ **لا تبعية دائرية**—`WhatsAppBot` لا يعرف `MessageHandler` والعكس
- ✅ **Type Safety كامل**—TypeScript يتحقق من أنواع الدوال
- ✅ **تتبع سهل**—`setMessageHandler((msg) => ...)` مباشر وواضح
- ✅ **Unit Testing**—يمكن تمرير handlers وهمية في الاختبارات
- ✅ **تغيير ضئيل**—الكود الحالي لا يتغير، فقط نضيف طريقتين setter

---

## MED-6: `addMessage` قبل `sendTypingIndicator`

**الملف:** `src/bot/MessageHandler.ts:154-157`

### الأعراض
- ترتيب التنفيذ: addMessage → sendTypingIndicator → getFullConversationHistory
- `sendTypingIndicator` غير ضروري قبل `getFullConversationHistory`

### الإصلاح

```typescript
// الخطوة 1: أرسل مؤشر الكتابة—هذا هو الأهم للمستخدم
await whatsappBot.sendTypingIndicator(replyTo);

// الخطوة 2: احصل على تاريخ المحادثة
const conversationHistory = conversationManager.getFullConversationHistory(phone);

// الخطوة 3: أضف رسالة المستخدم بعد تحضير كل شيء
conversationManager.addMessage(phone, 'user', messageForHistory || '[وسائط]');
```

---

## MED-7: Gemini model names

**الملف:** `src/config/config.ts:8-9`

### الإصلاح

```typescript
model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
fallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash',
```

وإضافة `.env.example`:

```env
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODEL=gemini-2.0-flash
```

---

# المرحلة 4: إصلاحات منخفضة (LOW)

---

## LOW-1: `cleanupStaleBrowser()` لا يدعم Windows

**الملف:** `src/bot/WhatsAppBot.ts:176-179`

### الإصلاح

```typescript
private async cleanupStaleBrowser(): Promise<void> {
    this.removeBrowserLockFiles();

    try {
        if (process.platform === 'win32') {
            execSync('taskkill /F /IM chrome.exe /T 2>nul || ver >nul', { stdio: 'ignore' });
            execSync('taskkill /F /IM chromium.exe /T 2>nul || ver >nul', { stdio: 'ignore' });
        } else {
            execSync('pkill -f "chromium.*wwebjs_auth" || true', { stdio: 'ignore' });
            execSync('pkill -f "chrome.*wwebjs_auth" || true', { stdio: 'ignore' });
            execSync('pkill -f "Google Chrome.*wwebjs_auth" || true', { stdio: 'ignore' });
            execSync('pkill -f "Chromium.*wwebjs_auth" || true', { stdio: 'ignore' });
        }
        logger.info('Cleaned up orphaned browser processes');
    } catch (err: any) {
        logger.debug('Browser process cleanup (non-critical):', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
    this.removeBrowserLockFiles();
}
```

---

## LOW-2: ApiService تصنيف أخطاء أكثر تخصصاً

**الملف:** `src/services/ApiService.ts`

### الإصلاح

```typescript
private handleApiError(error: any, context: string): ApiResponse<any> {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;

    // تصنيف الخطأ
    if (!error.response) {
        // Network error (DNS, timeout, connection refused)
        logger.error(`NETWORK_ERROR ${context}:`, message);
        return {
            success: false,
            message: 'تعذر الاتصال بالخادم. يرجى المحاولة لاحقاً.',
            data: {} as any,
        };
    }

    if (status >= 500) {
        // Server error
        logger.error(`SERVER_ERROR ${context}: ${status}`, message);
        return {
            success: false,
            message: 'الخادم يواجه مشكلة مؤقتة. يرجى المحاولة لاحقاً.',
            data: {} as any,
        };
    }

    if (status === 404) {
        return { success: false, message: 'المورد المطلوب غير موجود.', data: {} as any };
    }

    if (status === 429) {
        return { success: false, message: 'تم تجاوز الحد المسموح من الطلبات.', data: {} as any };
    }

    if (status >= 400) {
        return {
            success: false,
            message: message || 'طلب غير صحيح',
            errors: error.response?.data?.errors,
            data: {} as any,
        };
    }

    return { success: false, message: 'خطأ غير متوقع.', data: {} as any };
}
```

---

# جدول زمني مُقترح للإصلاح

| المرحلة | المدة المقدرة | الملفات المتأثرة | المخاطرة إن لم يُطبق |
|---------|---------------|------------------|----------------------|
| P0: أدوات الأمان | 30 دقيقة | `src/utils/timeout.ts` (جديد) | لا يمكن تطبيق باقي الإصلاحات بأمان |
| CRIT-1 | 1 ساعة | `src/bot/WhatsAppBot.ts` | الخدمة معطلة بالكامل عند أي عطل في Chromium |
| CRIT-2 | 45 دقيقة | `src/bot/MessageHandler.ts` | أرقام هواتف محجوبة إلى الأبد—رسائل قديمة ترسل لمستخدمين جدد |
| CRIT-3 | 15 دقيقة | `src/index.ts` | تلف قاعدة البيانات |
| HIGH-1 | 5 دقائق | `src/index.ts` | سلوك غير محدد بعد الأخطاء الجسيمة |
| HIGH-2 | 5 دقائق | `src/index.ts`, `package.json` | أخطاء صامتة تتراكم |
| HIGH-3 | 30 دقيقة | `src/services/RateLimiterService.ts` | هجوم سبام عند فشل DB |
| HIGH-4 | 1 ساعة | `src/services/ApiService.ts` | استثناءات غير معالجة |
| HIGH-5 | 30 دقيقة | `src/services/GeminiService.ts` | طلبات مفقودة من السجلات |
| HIGH-6 | 15 دقيقة | `src/services/GeminiService.ts` | فشل استدعاء Gemini |
| HIGH-7 | 15 دقيقة | `ecosystem.config.js` (جديد) | PM2 يتوقف عن إعادة التشغيل |
| MED-1..7 | 2 ساعات | ملفات متعددة | تجربة مستخدم سيئة، صيانة صعبة |
| LOW-1..2 | 30 دقيقة | ملفات متعددة | مشاكل توافقية نادرة |

---

# مصفوفة التبعيات

```
P0.1 (withTimeout + killProcess)
  ├── CRIT-1 (destroy + force kill)
  │     ├── CRIT-2 (queue timeout + token)
  │     ├── CRIT-3 (DB close + exit code)
  │     ├── HIGH-1 (uncaughtException—exit(1) بدون destroy)
  │     └── LOW-1 (killProcess يستخدم pkill -9)
  │
  ├── HIGH-3 (rateLimiter in-memory fallback)
  └── MED-1..3 (تحسينات) ← تستفيد من withTimeout

HIGH-4 (ApiService—3 مراحل: safe → migrate → delete)
  └── HIGH-5 (createOrder حفظ آمن) ← يحتاج createOrderSafe من HIGH-4

HIGH-7 (ecosystem.config.js)
  └── مستقل—يمكن تطبيقه في أي وقت بعد CRIT-1 (kill_timeout)

MED-5 (Dependency Injection)
  └── مستقل—لا يعتمد على أي إصلاح آخر
```

### ترتيب التنفيذ المُوصى به

```
المرحلة A (يوم 1): P0.1 → CRIT-1 → CRIT-2 → CRIT-3 → HIGH-1 → HIGH-2
  └── فترة مراقبة: 24 ساعة
  └── اختبار: إيقاف تشغيل البوت 5 مرات، محاكاة Chromium متجمد

المرحلة B (يوم 2): HIGH-3 → HIGH-4 (المرحلة 1 فقط) → HIGH-5 → HIGH-6 → HIGH-7
  └── فترة مراقبة: 24 ساعة
  └── اختبار: إرسال 30 طلب، قطع DB، قطع API

المرحلة C (يوم 3): MED-1..7 → LOW-1..2 → HIGH-4 (المرحلتين 2 و 3)
  └── فترة مراقبة: 24 ساعة
  └── اختبار: `npm run build`، اختبار شامل لجميع السيناريوهات
```

---

# قائمة التحقق النهائية (Pre-flight Checklist)

## Git & Rollback
- [ ] إنشاء Git tag قبل البدء: `git tag -a pre-fix-v1 -m "State before remediation"`
- [ ] بعد كل مرحلة، تأكيد `npm run build` يمر
- [ ] توثيق أي تغيير في Git commit منفصل

## P0.1: withTimeout
- [ ] `withTimeout` لا يقطع العمليات الطبيعية (اختبار: promise يكتمل قبل timeout)
- [ ] `abortResult.aborted` يمنع الإكمال المتأخر (اختبار: promise يكتمل بعد timeout)
- [ ] `killProcess()` يعمل على النظام الحالي

## CRIT-1: destroy()
- [ ] Chromium يُقتل بعد timeout (وليس فقط إزالة القفل)
- [ ] `SingletonLock` لا يبقى بعد `destroy()`
- [ ] بعد `destroy()`، يمكن بدء متصفح جديد بدون "browser already running"

## CRIT-2: Queue + Token
- [ ] `processingTokens` يمنع إرسال ردود قديمة لمستخدمين جدد
- [ ] `MAX_QUEUE_SIZE` يمنع DoS
- [ ] بعد timeout، قائمة الانتظار حرة للمستخدم

## CRIT-3: DB Close
- [ ] `databaseManager.close()` يُستدعى في `finally` (حتى مع خطأ)
- [ ] `process.exit(1)` عند فشل destroy
- [ ] `process.exit(0)` عند النجاح

## HIGH-1: uncaughtException
- [ ] `process.stderr.write` يكتب (وليس logger.error)
- [ ] `process.exit(1)` فوراً (بدون محاولة shutdown)

## HIGH-2: unhandledRejection
- [ ] `--unhandled-rejections=strict` في package.json
- [ ] handler الـ unhandledRejection القديم محذوف أو معدل

## HIGH-3: RateLimiter
- [ ] `periodicCleanup()` يمنع تسريب الذاكرة
- [ ] عند فشل DB، حد 20 رسالة/الدقيقة مطبق في الذاكرة

## HIGH-4: ApiService (3 مراحل)
- [ ] المرحلة 1: دوال Safe موجودة بجانب القديمة
- [ ] المرحلة 2: جميع المتصلين يستخدمون الدوال الجديدة
- [ ] المرحلة 3: الدوال القديمة محذوفة، `npm run build` يمر

## HIGH-5: Order Creation
- [ ] `pendingOrders` في الذاكرة يحفظ الطلب قبل API
- [ ] استرداد الطلبات المعلقة كل 5 دقائق
- [ ] الطلبات الأقدم من 30 دقيقة تُحذف (منع تسريب الذاكرة)

## HIGH-6: Product Catalog
- [ ] System Prompt يعرض 50 منتج كحد أقصى
- [ ] الـ AI يمكنه البحث عن المنتجات غير المعروضة
- [ ] دالة `search_products` موجودة في function declarations

## HIGH-7: PM2
- [ ] `ecosystem.config.js` مع `kill_timeout: 20000`
- [ ] `mkdir -p logs` في postinstall/start scripts
- [ ] ملفات السجل تُنشأ في `./logs/`

## MED-1..7
- [ ] رد Gemini فارغ → رسالة افتراضية
- [ ] رسالة خطأ في catch → try/catch منفصل
- [ ] typingSessions تُنظف عند disconnect
- [ ] Rate limiter config من ENV (RATE_LIMIT_PER_MINUTE, ...)
- [ ] Dependency Injection (بدلاً من EventBus)
- [ ] ترتيب addMessage بعد sendTypingIndicator
- [ ] Gemini model names محدثة

## LOW-1..2
- [ ] `cleanupStaleBrowser` يدعم Windows (taskkill)
- [ ] ApiService تصنيف الأخطاء (network, 4xx, 5xx)

## الاختبار النهائي
- [ ] `npm run build`—بدون أخطاء أو تحذيرات
- [ ] تشغيل البوت والاتصال بـ WhatsApp
- [ ] إرسال رسالة واستلام رد
- [ ] إيقاف البوت: `pm2 stop`—يخرج خلال 20 ثانية
- [ ] إعادة التشغيل: `pm2 start`—يعمل بدون "browser already running"
- [ ] محاكاة خطأ: قطع DB—الـ rate limiter يستخدم الذاكرة
- [ ] محاكاة خطأ: قطع API—رسالة خطأ مناسبة للمستخدم

---

**ملاحظة أمنية ختامية:** لا توجد خطة إصلاح كاملة بدون اختبار. يُوصى بشدة بإنشاء اختبارات وحدة (unit tests) لـ `withTimeout`, `RateLimiterService`, `ApiService` قبل نشر التغييرات. أصغر ثغرة في هذه الإصلاحات يمكن أن تؤدي إلى توقف الخدمة بالكامل. استخدم `git tag` للعودة السريعة في حال الطوارئ.

---
**تم إعداد الخطة بواسطة:** opencode audit  
**آخر تحديث:** 5 يونيو 2026  
**الإصدار:** 2.1 (مُراجعة أمنياً)
