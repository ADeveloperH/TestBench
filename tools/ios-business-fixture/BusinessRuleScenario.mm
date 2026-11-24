#import <Foundation/Foundation.h>

extern "C" const char *TB_BusinessScenarioArgument()
{
    static NSString *scenario;
    if (!scenario) {
        scenario = @"baseline";
        for (NSString *argument in NSProcessInfo.processInfo.arguments) {
            if ([argument hasPrefix:@"--tb-business-scenario="]) {
                scenario = [argument substringFromIndex:[@"--tb-business-scenario=" length]];
                break;
            }
        }
    }
    return scenario.UTF8String;
}
